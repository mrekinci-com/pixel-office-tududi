const {
    getTerminalConfig,
    getUploadConfig,
    validOrigin,
} = require('../../../services/TerminalConfig');
const {
    createTerminalLimiter,
} = require('../../../services/TerminalRateLimit');
const suffixes = [
    'ENABLED',
    'SOCKET',
    'URL',
    'ALLOWED_EMAILS',
    'UPLOAD_DIR',
    'UPLOAD_HOST_DIR',
    'LABEL',
    'CLI',
    'CREDENTIAL',
];
const names = suffixes.flatMap((suffix) => [
    `TERMINAL_${suffix}`,
    `CLAUDE_TERMINAL_${suffix}`,
]);
const original = Object.fromEntries(
    names.map((name) => [name, process.env[name]])
);
beforeEach(() => {
    for (const name of names) delete process.env[name];
});
afterEach(() => {
    for (const name of names) {
        if (original[name] === undefined) delete process.env[name];
        else process.env[name] = original[name];
    }
});
const enable = () => {
    process.env.TERMINAL_ENABLED = 'true';
    process.env.TERMINAL_SOCKET = '/run/terminal/ttyd.sock';
    process.env.TERMINAL_ALLOWED_EMAILS =
        ' OWNER@example.com, second@example.com ';
};
it('is off by default and requires explicit true for new settings', () => {
    expect(getTerminalConfig()).toBeNull();
    enable();
    delete process.env.TERMINAL_ENABLED;
    expect(getTerminalConfig()).toBeNull();
    process.env.TERMINAL_ENABLED = '1';
    expect(getTerminalConfig()).toBeNull();
});
it('normalizes the allowlist and defaults the label and informational CLI', () => {
    enable();
    expect(getTerminalConfig()).toMatchObject({
        emails: ['owner@example.com', 'second@example.com'],
        label: 'Terminal',
        cli: null,
        endpoint: { socketPath: '/run/terminal/ttyd.sock' },
    });
    process.env.TERMINAL_ALLOWED_EMAILS = ' , ';
    expect(getTerminalConfig()).toBeNull();
});
it('reads legacy variables including their implicit opt-in, while explicit new settings take priority', () => {
    for (const suffix of suffixes)
        process.env[`CLAUDE_TERMINAL_${suffix}`] =
            {
                SOCKET: '/old/ttyd.sock',
                ALLOWED_EMAILS: 'legacy@example.com',
                UPLOAD_DIR: '/old/uploads',
                UPLOAD_HOST_DIR: '/host/uploads',
                CLI: 'claude',
                LABEL: 'Private',
                CREDENTIAL: 'user:secret',
            }[suffix] || '';
    delete process.env.CLAUDE_TERMINAL_ENABLED;
    expect(getTerminalConfig()).toMatchObject({
        endpoint: { socketPath: '/old/ttyd.sock' },
        emails: ['legacy@example.com'],
        cli: 'claude',
        label: 'Private',
        credential: 'user:secret',
    });
    expect(getUploadConfig()).toEqual({
        dir: '/old/uploads',
        hostDir: '/host/uploads',
    });
    enable();
    process.env.TERMINAL_LABEL = 'New';
    process.env.TERMINAL_CLI = 'codex';
    expect(getTerminalConfig()).toMatchObject({
        endpoint: { socketPath: '/run/terminal/ttyd.sock' },
        emails: ['owner@example.com', 'second@example.com'],
        label: 'New',
        cli: 'codex',
    });
    process.env.TERMINAL_ENABLED = 'false';
    expect(getTerminalConfig()).toBeNull();
    process.env.TERMINAL_ENABLED = 'true';
    process.env.TERMINAL_ALLOWED_EMAILS = '';
    expect(getTerminalConfig()).toBeNull();
});
it.each([
    'http://example.com:7681',
    'http://127.0.0.1.example.com',
    'https://127.0.0.1:7681',
    'http://user:pass@127.0.0.1',
    'http://127.0.0.1/?token=secret',
    'http://127.0.0.1/#fragment',
    'file:///tmp/ttyd',
    'garbage',
])('fails closed for unsafe upstream %s', (url) => {
    enable();
    delete process.env.TERMINAL_SOCKET;
    process.env.TERMINAL_URL = url;
    expect(getTerminalConfig()).toBeNull();
});
it.each([
    ['http://127.0.0.1:7681/base/', '127.0.0.1'],
    ['http://localhost:7681/base/', '127.0.0.1'],
    ['http://[::1]:7681/base/', '::1'],
])('accepts loopback %s and pins localhost to loopback', (url, hostname) => {
    enable();
    delete process.env.TERMINAL_SOCKET;
    process.env.TERMINAL_URL = url;
    expect(getTerminalConfig()).toMatchObject({
        endpoint: { hostname, port: 7681 },
        basePath: '/base',
    });
});
it('rejects a relative socket and a relative upload directory', () => {
    enable();
    process.env.TERMINAL_SOCKET = 'relative.sock';
    expect(getTerminalConfig()).toBeNull();
    process.env.TERMINAL_UPLOAD_DIR = 'uploads';
    process.env.TERMINAL_UPLOAD_HOST_DIR = '/host/images';
    expect(getUploadConfig()).toBeNull();
});
it('requires a matching full Origin including protocol and port, and permits missing Origin only on reads', () => {
    const req = {
        headers: {
            host: 'example.test:8443',
            origin: 'https://example.test:8443',
            'x-forwarded-proto': 'https',
        },
    };
    expect(validOrigin(req, true)).toBe(true);
    req.headers.origin = 'http://example.test:8443';
    expect(validOrigin(req, true)).toBe(false);
    delete req.headers.origin;
    expect(validOrigin(req)).toBe(true);
    expect(validOrigin(req, true)).toBe(false);
    req.headers['sec-fetch-site'] = 'same-site';
    expect(validOrigin(req)).toBe(false);
});
it('rate limits independent scopes and resets after a minute, including WS entries', () => {
    let now = 1000;
    const allow = createTerminalLimiter(() => now);
    expect(allow('user:1', 2)).toBe(true);
    expect(allow('user:1', 2)).toBe(true);
    expect(allow('user:1', 2)).toBe(false);
    expect(allow('user:2', 2)).toBe(true);
    now += 60000;
    expect(allow('user:1', 2)).toBe(true);
});
