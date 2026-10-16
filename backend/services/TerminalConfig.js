const path = require('path');

// Explicit new values (including an empty string or false) override legacy ones.
function terminalEnv(name) {
    return (
        process.env[`TERMINAL_${name}`] ??
        process.env[`CLAUDE_TERMINAL_${name}`]
    );
}

function getApplicationBasePath() {
    const value = (process.env.TUDUDI_BASE_PATH || '').trim();
    if (!value || value === '/') return '';
    const base = value.replace(/\/$/, '');
    return base.startsWith('/') ? base : `/${base}`;
}

function getTerminalConfig() {
    const enabled = terminalEnv('ENABLED');
    // Old installations had no enable flag. Preserve that opt-in only when
    // their old endpoint variables are present; new installs require true.
    const legacy =
        process.env.CLAUDE_TERMINAL_SOCKET || process.env.CLAUDE_TERMINAL_URL;
    if (enabled !== 'true' && !(enabled === undefined && legacy)) return null;
    const emails = (terminalEnv('ALLOWED_EMAILS') || '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
    if (!emails.length) return null;
    const socketPath = (terminalEnv('SOCKET') || '').trim();
    let endpoint;
    let basePath = '';
    if (socketPath) {
        if (!path.isAbsolute(socketPath) || socketPath.includes('\0'))
            return null;
        endpoint = { socketPath };
    } else {
        try {
            const url = new URL(terminalEnv('URL'));
            if (
                url.protocol !== 'http:' ||
                url.username ||
                url.password ||
                url.search ||
                url.hash ||
                !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
            )
                return null;
            endpoint = {
                hostname: url.hostname === '[::1]' ? '::1' : '127.0.0.1',
                port: Number(url.port || 80),
            };
            basePath = url.pathname.replace(/\/$/, '');
        } catch {
            return null;
        }
    }
    return {
        endpoint,
        basePath,
        // Old socket launchers expect an owned project UID as ttyd URL arg.
        // New endpoint settings use a host-selected session with no URL args.
        legacyProjectArgs:
            !!legacy &&
            process.env.TERMINAL_SOCKET === undefined &&
            process.env.TERMINAL_URL === undefined,
        emails,
        credential: terminalEnv('CREDENTIAL') || null,
        label: (terminalEnv('LABEL') || '').trim().slice(0, 80) || 'Terminal',
        cli: ['claude', 'codex'].includes(terminalEnv('CLI'))
            ? terminalEnv('CLI')
            : null,
    };
}

function getUploadConfig() {
    const dir = (terminalEnv('UPLOAD_DIR') || '').trim();
    const hostDir = (terminalEnv('UPLOAD_HOST_DIR') || '').trim();
    // This path is pasted into the CLI: no whitespace, shell metacharacters,
    // control bytes, dot segments or ambiguous separators.
    if (
        !path.isAbsolute(dir) ||
        dir.includes('\0') ||
        !/^\/[A-Za-z0-9._/-]+$/.test(hostDir) ||
        hostDir.includes('//') ||
        hostDir.split('/').some((part) => part === '.' || part === '..')
    )
        return null;
    return { dir, hostDir: hostDir.replace(/\/$/, '') };
}

function validOrigin(req, required = false) {
    if (['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']))
        return false;
    const value = req.headers.origin;
    if (!value) return !required;
    try {
        const origin = new URL(value);
        const protocol = req.socket?.encrypted
            ? 'https'
            : req.headers['x-forwarded-proto'] || 'http';
        return (
            ['http', 'https'].includes(protocol) &&
            origin.origin === value &&
            origin.protocol === `${protocol}:` &&
            origin.host.toLowerCase() === (req.headers.host || '').toLowerCase()
        );
    } catch {
        return false;
    }
}

module.exports = {
    getTerminalConfig,
    getUploadConfig,
    getApplicationBasePath,
    validOrigin,
};
