'use strict';

// Optional external access gate. An explicit false keeps legacy private-only
// mode; true requires a generic signed identity token AND normal Tududi login.
// With the variable unset, ordinary Tududi authentication handles all hosts.
function privateHostsFromEnvironment() {
    const hosts = new Set(['localhost', '127.0.0.1']);
    // Keep the exact loopback authority used by the health check and office proxy.
    const port = process.env.PORT || '3002';
    if (/^[1-9]\d{0,4}$/.test(port) && Number(port) <= 65535) {
        hosts.add(`127.0.0.1:${port}`);
    }
    return hosts;
}

function needsPublicGate(
    req,
    privateHosts,
    tokenHeader = 'x-panel-access-token'
) {
    const headers = req.headers || {};
    // Node keeps only the first Host value in req.headers. A duplicated Host
    // is ambiguous and must not inherit the first value's private bypass.
    const duplicateHost =
        Array.isArray(req.rawHeaders) &&
        req.rawHeaders.filter(
            (value, index) => index % 2 === 0 && value.toLowerCase() === 'host'
        ).length > 1;
    // Header presence (including an empty value) forces the external gate.
    // Do not trim, parse, or normalize private authorities beyond letter case.
    return (
        typeof headers.host !== 'string' ||
        duplicateHost ||
        !privateHosts.has(headers.host.toLowerCase()) ||
        [tokenHeader, 'x-forwarded-host'].some((name) =>
            Object.hasOwn(headers, name)
        )
    );
}

function httpsUrl(value, label) {
    const url = new URL(value);
    if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.hash ||
        url.search
    ) {
        throw new Error(`${label} must be an HTTPS URL`);
    }
    return url;
}

function validateConfig(config) {
    const publicUrl = httpsUrl(config.publicOrigin, 'Public origin');
    if (publicUrl.pathname !== '/')
        throw new Error('Public origin cannot include a path');
    httpsUrl(config.issuer, 'Token issuer');
    httpsUrl(config.jwksUrl, 'Signing keys URL');
    if (typeof config.audience !== 'string' || !config.audience.trim()) {
        throw new Error('Token audience configuration is required');
    }
    if (
        !/^[a-z0-9-]+$/.test(config.tokenHeader || '') ||
        [
            'host',
            'authorization',
            'cookie',
            'x-forwarded-host',
            'x-forwarded-proto',
        ].includes(config.tokenHeader)
    ) {
        throw new Error('A separate identity token header is required');
    }
    if (
        typeof config.ownerEmail !== 'string' ||
        config.ownerEmail !== config.ownerEmail.trim().toLowerCase() ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.ownerEmail)
    ) {
        throw new Error('An exact normalized owner email is required');
    }
    return publicUrl;
}

// Apply policy to segments rather than Express route patterns. The auth router
// uses strict=false/caseSensitive=false, and mounting it under /api also accepts
// repeated separators. Decode before splitting so encoded '/' and ';' cannot
// hide a forbidden endpoint. Ambiguous/malformed encodings fail closed.
function normalizedPathSegments(path) {
    let decoded = path;
    for (let depth = 0; depth < 8; depth++) {
        try {
            const next = decodeURIComponent(decoded);
            if (next === decoded) {
                return decoded
                    .split('/')
                    .map((segment) => segment.split(';')[0].toLowerCase())
                    .filter(Boolean);
            }
            decoded = next;
        } catch {
            return null;
        }
    }
    return null;
}

function securityHeaders(res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

async function createPanelAccess(config, dependencies = {}) {
    const privateHosts = privateHostsFromEnvironment();
    const publicUrl = validateConfig(config);
    const { jwtVerify, createRemoteJWKSet } = await import('jose');
    const keySet =
        dependencies.keySet ||
        createRemoteJWKSet(new URL(config.jwksUrl), {
            timeoutDuration: 4000,
            cooldownDuration: 30000,
            cacheMaxAge: 300000,
        });
    const clock = dependencies.clock || Date.now;
    const audit =
        dependencies.audit ||
        ((event) => console.info(`[panel-access] ${event}`));
    async function identity(req) {
        if (req.headers.host?.toLowerCase() !== publicUrl.host)
            throw new Error('Canonical public host required');
        if (req.headers['x-forwarded-proto'] !== 'https')
            throw new Error('HTTPS required');
        const token = req.headers[config.tokenHeader];
        if (typeof token !== 'string' || token.length > 16384)
            throw new Error('Access token required');
        const { payload } = await jwtVerify(token, keySet, {
            issuer: config.issuer,
            audience: config.audience,
            algorithms: ['RS256'],
            requiredClaims: ['exp', 'iat', 'sub', 'email'],
            currentDate: new Date(clock()),
            clockTolerance: 0,
        });
        if (
            typeof payload.sub !== 'string' ||
            !payload.sub ||
            typeof payload.email !== 'string' ||
            payload.email.toLowerCase() !== config.ownerEmail ||
            payload.iat > Math.floor(clock() / 1000)
        ) {
            throw new Error('Owner identity required');
        }
        return {
            sub: payload.sub,
            email: payload.email.toLowerCase(),
            expiresAt: payload.exp * 1000,
        };
    }

    async function middleware(req, res, next) {
        if (!needsPublicGate(req, privateHosts, config.tokenHeader)) {
            // A session previously used on HTTPS must still work on local HTTP.
            if (req.session?.cookie) req.session.cookie.secure = false;
            return next();
        }
        const segments = normalizedPathSegments(req.path);
        securityHeaders(res);
        try {
            await identity(req);
        } catch {
            audit('access_denied');
            return res
                .status(403)
                .json({ error: 'Dış panel kimlik doğrulaması gerekli.' });
        }

        // identity() requires the public host and forwarded HTTPS. Keep the
        // normal Tududi session/user and its existing 30-day lifetime.
        if (req.session?.cookie) req.session.cookie.secure = true;
        if (!segments) return res.status(403).end();
        // Deny these segments anywhere below /api, independent of router
        // versions, mount behavior, strict routing or case sensitivity.
        if (
            segments[0] === 'api' &&
            segments
                .slice(1)
                .some((segment) =>
                    ['register', 'verify-email'].includes(segment)
                )
        ) {
            return res.status(403).end();
        }
        return next();
    }

    return { middleware };
}

// Synchronous facade for Tududi's existing CommonJS app. Failed/missing config
// blocks every external request in an explicitly configured gate mode.
function fromEnvironment(dependencies = {}) {
    const privateHosts = privateHostsFromEnvironment();
    const mode = process.env.PANEL_ACCESS_ENABLED;
    const tokenHeader =
        process.env.PANEL_ACCESS_TOKEN_HEADER || 'x-panel-access-token';
    if (mode === undefined) return { middleware: (req, res, next) => next() };
    let ready;
    if (
        process.env.PANEL_ACCESS_ENABLED === 'true' &&
        process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0'
    ) {
        const config = {
            issuer: process.env.PANEL_ACCESS_ISSUER,
            audience: process.env.PANEL_ACCESS_AUD,
            ownerEmail: process.env.PANEL_OWNER_EMAIL,
            publicOrigin: process.env.PANEL_PUBLIC_ORIGIN,
            jwksUrl: process.env.PANEL_ACCESS_JWKS_URL,
            tokenHeader,
        };
        ready = createPanelAccess(config, dependencies).catch(() => {
            console.error('[panel-access] configuration_failed');
            return null;
        });
    } else {
        ready = Promise.resolve(null);
    }
    return {
        middleware: async (req, res, next) => {
            if (!needsPublicGate(req, privateHosts, tokenHeader)) {
                if (req.session?.cookie) req.session.cookie.secure = false;
                return next();
            }
            const gate = await ready;
            if (!gate) {
                securityHeaders(res);
                return res
                    .status(503)
                    .json({ error: 'Panel erişimi henüz etkin değil.' });
            }
            return gate.middleware(req, res, next);
        },
    };
}

module.exports = { createPanelAccess, fromEnvironment };
