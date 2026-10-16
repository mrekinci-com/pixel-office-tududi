const http = require('http');
const net = require('net');
const { User, Project } = require('../models');
const {
    getTerminalConfig,
    getApplicationBasePath,
    validOrigin,
} = require('./TerminalConfig');
const { allowTerminalRequest } = require('./TerminalRateLimit');

const securityHeaders = {
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'SAMEORIGIN',
    'x-content-type-options': 'nosniff',
};

async function getSessionUser(req) {
    // Never use currentUser: requireAuth also populates it for Bearer tokens.
    if (/^Bearer(?:\s|$)/i.test(req.headers.authorization || '')) return null;
    return req.session?.userId ? User.findByPk(req.session.userId) : null;
}

function isAllowed(user, config) {
    return !!user && config.emails.includes(user.email.trim().toLowerCase());
}

// Also accept the root path when an ingress proxy strips the application prefix.
function terminalRequest(req) {
    const [rawPath, query = ''] = req.url.split('?');
    const prefixes = [
        `${getApplicationBasePath()}/terminal-proxy`,
        '/terminal-proxy',
    ];
    const prefix = prefixes.find(
        (value) => rawPath === value || rawPath.startsWith(`${value}/`)
    );
    if (!prefix) return null;
    let path;
    try {
        path = decodeURIComponent(rawPath.slice(prefix.length)) || '/';
    } catch {
        return { invalid: true };
    }
    // Reject ambiguous encodings rather than allowing URL parsers to normalize
    // traversal, backslashes or repeated separators into another endpoint.
    if (
        !/^\/[a-zA-Z0-9._/-]*$/.test(path) ||
        path.includes('//') ||
        path.split('/').some((part) => part === '.' || part === '..')
    ) {
        return { invalid: true };
    }
    return { path, query, prefix };
}

async function authorize(req, target, upgrade = false) {
    const config = getTerminalConfig();
    if (!config) return { status: 404 };
    if (!allowTerminalRequest(`ip:${req.socket?.remoteAddress}`, 300))
        return { status: 429 };
    const user = await getSessionUser(req);
    if (!user) return { status: 401 };
    if (!isAllowed(user, config)) return { status: 403 };
    if (!validOrigin(req, upgrade)) return { status: 403 };
    if (target.invalid || (upgrade && target.path !== '/ws'))
        return { status: 404 };
    if (
        !['GET', 'HEAD'].includes(req.method) ||
        (upgrade && req.method !== 'GET')
    )
        return { status: 405 };
    if (!allowTerminalRequest(`user:${user.id}`)) return { status: 429 };
    // Preserve old project-aware launchers only for legacy endpoint settings.
    // Each UID must still belong to this session user; no other args survive.
    let query = '';
    if (config.legacyProjectArgs) {
        const args = new URLSearchParams(target.query).getAll('arg');
        if (args.length || ['/', '/index.html', '/ws'].includes(target.path)) {
            if (args.length !== 1 || !/^[a-z0-9]{8,40}$/.test(args[0]))
                return { status: 404 };
            const project = await Project.findOne({
                where: { uid: args[0], user_id: user.id },
                attributes: ['id'],
            });
            if (!project) return { status: 404 };
            query = `?arg=${args[0]}`;
        }
    }
    // New installations never forward browser command arguments. The host
    // launcher owns the workspace and persistent tmux session.
    return { config, path: `${config.basePath}${target.path}${query}` };
}

async function requireTerminalSession(req, res, next) {
    for (const [name, value] of Object.entries(securityHeaders))
        res.setHeader(name, value);
    try {
        const config = getTerminalConfig();
        if (!config) return res.status(404).end();
        if (!allowTerminalRequest(`ip:${req.socket?.remoteAddress}`, 300))
            return res.status(429).end();
        const user = await getSessionUser(req);
        if (!user) return res.status(401).end();
        if (
            !isAllowed(user, config) ||
            !validOrigin(req, req.method === 'POST')
        )
            return res.status(403).end();
        if (!allowTerminalRequest(`user:${user.id}`))
            return res.status(429).end();
        if (
            req.method === 'POST' &&
            !allowTerminalRequest(`upload:${user.id}`, 20)
        )
            return res.status(429).end();
        req.terminalConfig = config;
        return next();
    } catch (error) {
        next(error);
    }
}

function upstreamHeaders(req, config, upgrade = false) {
    // Use a small allowlist: browser credentials, cookies and proxy headers
    // must not reach the host service.
    const names = upgrade
        ? [
              'host',
              'origin',
              'sec-websocket-key',
              'sec-websocket-version',
              'sec-websocket-protocol',
          ]
        : [
              'host',
              'accept',
              'accept-encoding',
              'content-type',
              'content-length',
          ];
    const headers = {};
    for (const name of names) {
        if (req.headers[name] !== undefined) headers[name] = req.headers[name];
    }
    if (config.credential) {
        headers.authorization = `Basic ${Buffer.from(config.credential).toString('base64')}`;
    }
    headers.connection = upgrade ? 'Upgrade' : 'close';
    if (upgrade) headers.upgrade = 'websocket';
    return headers;
}

function responseHeaders(headers) {
    const clean = { ...headers, ...securityHeaders };
    for (const name of [
        'connection',
        'transfer-encoding',
        'keep-alive',
        'set-cookie',
        'www-authenticate',
    ]) {
        delete clean[name];
    }
    if (clean['content-security-policy']) {
        clean['content-security-policy'] =
            clean['content-security-policy'].replace(
                /(?:^|;)\s*frame-ancestors\s+[^;]*/gi,
                ''
            ) + "; frame-ancestors 'self'";
    }
    return clean;
}

function proxyHttp(req, res, next) {
    const target = terminalRequest(req);
    if (!target) return next();
    for (const [name, value] of Object.entries(securityHeaders)) {
        res.setHeader(name, value);
    }
    const fail = (status) => {
        if (!res.headersSent) res.status(status).end();
        else res.destroy();
    };
    authorize(req, target)
        .then((result) => {
            if (result.status) return fail(result.status);
            // The trailing slash is necessary for ttyd's relative token/ws URLs.
            if (req.url.split('?')[0] === target.prefix) {
                return res.redirect(
                    302,
                    `${target.prefix}/${result.path.includes('?') ? result.path.slice(result.path.indexOf('?')) : ''}`
                );
            }
            const upstream = http.request(
                {
                    ...result.config.endpoint,
                    path: result.path,
                    method: req.method,
                    headers: upstreamHeaders(req, result.config),
                },
                (incoming) => {
                    res.writeHead(
                        incoming.statusCode,
                        responseHeaders(incoming.headers)
                    );
                    incoming.on('error', () => fail(502));
                    incoming.pipe(res);
                }
            );
            upstream.setTimeout(10000, () =>
                upstream.destroy(new Error('Terminal timeout'))
            );
            upstream.on('error', () => fail(502));
            req.on('aborted', () => upstream.destroy());
            req.on('error', () => upstream.destroy());
            res.on('close', () => upstream.destroy());
            req.pipe(upstream);
        })
        .catch(() => fail(502));
}

function rejectUpgrade(socket, status) {
    if (socket.destroyed || socket.writableEnded) return;
    socket.end(
        `HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\n` +
            'Connection: close\r\nContent-Length: 0\r\n' +
            'Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n\r\n',
        () => socket.destroy()
    );
}

// Run the existing public panel policy on upgrades too. It normally uses an
// Express response, while upgrades only have a raw socket.
function checkUpgradeGate(req, middleware) {
    if (!middleware) return Promise.resolve(0);
    return new Promise((resolve, reject) => {
        const res = new http.ServerResponse(req);
        res.status = (status) => {
            res.statusCode = status;
            return res;
        };
        res.json = () => res.end();
        res.end = () => {
            resolve(res.statusCode);
            return res;
        };
        req.path = req.url.split('?')[0];
        Promise.resolve(
            middleware(req, res, (error) =>
                error ? reject(error) : resolve(0)
            )
        ).catch(reject);
    });
}

function attachUpgrade(server, sessionMiddleware, panelMiddleware) {
    const listener = async (req, socket, head) => {
        // Attach the error handler first: Node removes its own socket
        // listeners during an upgrade, so an unhandled reset would crash the
        // process. No other route accepts upgrades, so close the rest.
        socket.on('error', () => socket.destroy());
        const target = terminalRequest(req);
        if (!target) return rejectUpgrade(socket, 404);
        try {
            if (!getTerminalConfig()) return rejectUpgrade(socket, 404);
            // express-session needs a real ServerResponse interface, but this
            // response is never sent: only the stored browser session is read.
            await new Promise((resolve, reject) => {
                sessionMiddleware(req, new http.ServerResponse(req), (error) =>
                    error ? reject(error) : resolve()
                );
            });
            const gateStatus = await checkUpgradeGate(req, panelMiddleware);
            if (gateStatus) return rejectUpgrade(socket, gateStatus);
            const result = await authorize(req, target, true);
            if (result.status) return rejectUpgrade(socket, result.status);
            if (socket.destroyed) return;
            const endpoint = result.config.endpoint;
            const upstream = endpoint.socketPath
                ? net.connect(endpoint.socketPath)
                : net.connect(endpoint.port, endpoint.hostname);
            let upgraded = false;
            let buffer = Buffer.alloc(0);
            const fail = () => {
                if (upgraded) socket.destroy();
                else rejectUpgrade(socket, 502);
                upstream.destroy();
            };
            upstream.setTimeout(10000, fail);
            upstream.on('error', fail);
            upstream.on('end', () => {
                if (!upgraded) fail();
            });
            socket.on('close', () => upstream.destroy());
            upstream.on('close', () => {
                if (upgraded) socket.destroy();
            });
            upstream.on('connect', () => {
                const headers = upstreamHeaders(req, result.config, true);
                upstream.write(
                    `GET ${result.path} HTTP/1.1\r\n` +
                        Object.entries(headers)
                            .map(([name, value]) => `${name}: ${value}\r\n`)
                            .join('') +
                        '\r\n'
                );
                if (head.length) upstream.write(head);
            });
            const readHandshake = (chunk) => {
                buffer = Buffer.concat([buffer, chunk]);
                const end = buffer.indexOf('\r\n\r\n');
                if (end < 0 || end > 65536) {
                    if (buffer.length > 65536) fail();
                    return;
                }
                const lines = buffer
                    .subarray(0, end)
                    .toString('latin1')
                    .split('\r\n');
                if (!/^HTTP\/1\.[01] 101(?: |$)/.test(lines[0])) return fail();
                const headers = lines
                    .slice(1)
                    .filter(
                        (line) =>
                            !/^(cache-control|referrer-policy|set-cookie|www-authenticate):/i.test(
                                line
                            )
                    );
                socket.write(
                    lines[0] +
                        '\r\n' +
                        headers.join('\r\n') +
                        '\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n\r\n'
                );
                upgraded = true;
                upstream.setTimeout(0);
                upstream.removeListener('data', readHandshake);
                const rest = buffer.subarray(end + 4);
                if (rest.length) socket.write(rest);
                upstream.pipe(socket);
                socket.pipe(upstream);
            };
            upstream.on('data', readHandshake);
        } catch {
            rejectUpgrade(socket, 502);
        }
    };
    server.on('upgrade', listener);
    return () => server.removeListener('upgrade', listener);
}

module.exports = {
    attachUpgrade,
    requireTerminalSession,
    terminalRequest,
    proxyHttp,
    getTerminalConfig,
    getSessionUser,
    isAllowed,
    getApplicationBasePath,
};
