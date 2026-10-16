const request = require('supertest');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const app = require('../../app');
const { Project } = require('../../models');
const { attachUpgrade } = require('../../services/TerminalProxy');
const { createTestUser } = require('../helpers/testUtils');

const envNames = [
    'TERMINAL_ENABLED',
    'TERMINAL_SOCKET',
    'TERMINAL_URL',
    'TERMINAL_ALLOWED_EMAILS',
    'TERMINAL_LABEL',
    'TERMINAL_CLI',
    'TUDUDI_BASE_PATH',
    'CLAUDE_TERMINAL_SOCKET',
    'CLAUDE_TERMINAL_URL',
    'CLAUDE_TERMINAL_ALLOWED_EMAILS',
];
const originalEnv = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]])
);
const listen = (server, address) =>
    new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(address, resolve);
    });
const close = (server) => new Promise((resolve) => server.close(resolve));

describe('Terminal authenticated same-origin proxy', () => {
    let upstream,
        server,
        sockets,
        dir,
        agent,
        user,
        cookie,
        lastRequest,
        lastUpgrade,
        detachUpgrade;
    beforeEach(async () => {
        for (const name of envNames) delete process.env[name];
        sockets = new Set();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-proxy-'));
        process.env.TERMINAL_ENABLED = 'true';
        process.env.TERMINAL_SOCKET = path.join(dir, 'ttyd.sock');
        process.env.TERMINAL_ALLOWED_EMAILS =
            ' TEST@EXAMPLE.COM, second@example.com ';
        upstream = http.createServer((req, res) => {
            lastRequest = { url: req.url, headers: req.headers };
            res.setHeader('Cache-Control', 'public');
            res.setHeader('Set-Cookie', 'upstream=secret');
            res.setHeader('X-Frame-Options', 'DENY');
            res.setHeader(
                'Content-Security-Policy',
                "default-src 'self'; frame-ancestors 'none'"
            );
            res.end(JSON.stringify(lastRequest));
        });
        upstream.on('upgrade', (req, socket, head) => {
            lastUpgrade = { url: req.url, headers: req.headers };
            socket.write(
                'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSet-Cookie: upstream=secret\r\n\r\nupstream-ready'
            );
            if (head.length) socket.write(head);
            socket.on('data', (data) => socket.write(data));
        });
        const track = (socket) => {
            sockets.add(socket);
            socket.on('close', () => sockets.delete(socket));
        };
        upstream.on('connection', track);
        await listen(upstream, process.env.TERMINAL_SOCKET);
        server = http.createServer(app);
        detachUpgrade = attachUpgrade(
            server,
            app.terminalSessionMiddleware,
            app.terminalPanelMiddleware
        );
        server.on('connection', track);
        await listen(server, { host: '127.0.0.1', port: 0 });
        user = await createTestUser();
        agent = request.agent(server).set('Host', 'localhost');
        const login = await agent
            .post('/api/login')
            .send({ email: user.email, password: 'password123' });
        if (login.status !== 200) throw new Error('Terminal test login failed');
        cookie = login.headers['set-cookie']
            .map((value) => value.split(';')[0])
            .join('; ');
        lastRequest = undefined;
        lastUpgrade = undefined;
    });
    afterEach(async () => {
        for (const socket of sockets) socket.destroy();
        await Promise.all([close(server), close(upstream)]);
        fs.rmSync(dir, { recursive: true, force: true });
        for (const name of envNames) {
            if (originalEnv[name] === undefined) delete process.env[name];
            else process.env[name] = originalEnv[name];
        }
    });
    function upgrade(url = '/terminal-proxy/ws', options = {}) {
        return new Promise((resolve, reject) => {
            const socket = net.connect(server.address().port, '127.0.0.1');
            let data = '',
                sent = false;
            const timer = setTimeout(() => {
                socket.destroy();
                reject(new Error('Upgrade timed out'));
            }, 3000);
            const finish = () => {
                clearTimeout(timer);
                socket.destroy();
                resolve(data);
            };
            socket.on('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });
            socket.on('connect', () =>
                socket.write(
                    `GET ${url} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
                        (options.cookie === false
                            ? ''
                            : `Cookie: ${cookie}\r\n`) +
                        (options.origin === false
                            ? ''
                            : `Origin: ${options.origin || 'http://localhost'}\r\n`) +
                        (options.authorization
                            ? `Authorization: ${options.authorization}\r\n`
                            : '') +
                        '\r\n' +
                        (options.head || '')
                )
            );
            socket.on('data', (chunk) => {
                data += chunk.toString();
                if (options.echo && data.includes('upstream-ready') && !sent) {
                    sent = true;
                    socket.write('client-payload');
                }
                if (
                    data.includes('101 Switching') &&
                    (!options.echo ||
                        (data.includes('client-payload') &&
                            (!options.head || data.includes(options.head))))
                )
                    finish();
            });
            socket.on('end', finish);
        });
    }
    function rawHttp(url) {
        return new Promise((resolve, reject) => {
            const req = http.get(
                {
                    hostname: '127.0.0.1',
                    port: server.address().port,
                    path: url,
                    headers: { cookie },
                },
                (res) => {
                    res.resume();
                    res.on('end', () => resolve(res.statusCode));
                }
            );
            req.on('error', reject);
        });
    }
    it('returns 404 for every Terminal endpoint when disabled, including anonymous requests and WS', async () => {
        process.env.TERMINAL_ENABLED = 'false';
        for (const url of [
            '/terminal',
            '/api/terminal/config',
            '/api/v1/terminal/config',
            '/terminal-proxy/',
            '/terminal-proxy/token',
        ]) {
            expect((await request(server).get(url)).status).toBe(404);
        }
        expect(
            (await request(server).post('/api/terminal/upload')).status
        ).toBe(404);
        expect(await upgrade()).toContain('404 Not Found');
        expect(lastRequest).toBeUndefined();
        expect(lastUpgrade).toBeUndefined();
    });
    it('requires the enable flag, endpoint and nonempty allowlist', async () => {
        for (const name of [
            'TERMINAL_ENABLED',
            'TERMINAL_SOCKET',
            'TERMINAL_ALLOWED_EMAILS',
        ]) {
            const previous = process.env[name];
            delete process.env[name];
            expect((await agent.get('/api/terminal/config')).status).toBe(404);
            expect(await upgrade()).toContain('404 Not Found');
            process.env[name] = previous;
        }
    });
    it('requires a session for config, page, HTTP and WS; Bearer cannot replace or accompany it', async () => {
        for (const url of [
            '/api/terminal/config',
            '/api/v1/terminal/config',
            '/terminal-proxy/',
            '/terminal',
        ]) {
            expect((await request(server).get(url)).status).toBe(401);
            expect(
                (await agent.get(url).set('Authorization', 'Bearer ignored'))
                    .status
            ).toBe(401);
        }
        expect(
            await upgrade('/terminal-proxy/ws', { cookie: false })
        ).toContain('401 Unauthorized');
        expect(
            await upgrade('/terminal-proxy/ws', {
                authorization: 'Bearer ignored',
            })
        ).toContain('401 Unauthorized');
        expect(lastUpgrade).toBeUndefined();
    });
    it('checks the email allowlist on HTTP and WS against the current database user', async () => {
        process.env.TERMINAL_ALLOWED_EMAILS = 'someone-else@example.com';
        for (const url of [
            '/terminal',
            '/api/terminal/config',
            '/terminal-proxy/',
            '/terminal-proxy/token',
        ])
            expect((await agent.get(url)).status).toBe(403);
        expect(await upgrade()).toContain('403 Forbidden');
        expect(lastRequest).toBeUndefined();
        expect(lastUpgrade).toBeUndefined();
    });
    it('exposes only generic UI configuration, without a project, socket, host path or credentials', async () => {
        process.env.TERMINAL_LABEL = 'Workspace';
        process.env.TERMINAL_CLI = 'codex';
        const response = await agent.get('/api/terminal/config');
        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            enabled: true,
            upload_enabled: false,
            base_url: '/terminal-proxy/',
            label: 'Workspace',
            cli: 'codex',
        });
        expect(response.headers['cache-control']).toBe('no-store');
        process.env.TUDUDI_BASE_PATH = '/tools/tududi/';
        expect((await agent.get('/api/v1/terminal/config')).body.base_url).toBe(
            '/tools/tududi/terminal-proxy/'
        );
        expect(
            (await agent.get('/tools/tududi/terminal-proxy/token')).status
        ).toBe(200);
    });
    it('proxies HTTP with a trailing-slash redirect and strips cookies, auth, identity headers and all URL arguments', async () => {
        expect((await agent.get('/terminal-proxy')).headers.location).toBe(
            '/terminal-proxy/'
        );
        const response = await agent
            .get('/terminal-proxy/?arg=arbitrary&command=sh&token=secret')
            .set('X-Panel-Access-Token', 'identity-secret')
            .set('X-Forwarded-Host', 'host-secret');
        expect(response.status).toBe(200);
        expect(lastRequest.url).toBe('/');
        expect(lastRequest.headers.cookie).toBeUndefined();
        expect(lastRequest.headers.authorization).toBeUndefined();
        expect(lastRequest.headers['x-panel-access-token']).toBeUndefined();
        expect(lastRequest.headers['x-forwarded-host']).toBeUndefined();
        expect(response.headers['set-cookie']).toBeUndefined();
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
        expect(response.headers['content-security-policy']).toBe(
            "default-src 'self'; frame-ancestors 'self'"
        );
    });
    it.each([
        'https://evil.example',
        'null',
        'invalid',
        'https://localhost',
        'http://localhost:99',
    ])('rejects Origin %s on HTTP and WS', async (origin) => {
        expect(
            (await agent.get('/terminal-proxy/token').set('Origin', origin))
                .status
        ).toBe(403);
        expect(await upgrade('/terminal-proxy/ws', { origin })).toContain(
            '403 Forbidden'
        );
        expect(lastRequest).toBeUndefined();
        expect(lastUpgrade).toBeUndefined();
    });
    it('rejects missing WS Origin and cross-site fetch metadata', async () => {
        expect(
            await upgrade('/terminal-proxy/ws', { origin: false })
        ).toContain('403 Forbidden');
        expect(
            (
                await agent
                    .get('/terminal-proxy/')
                    .set('Sec-Fetch-Site', 'cross-site')
            ).status
        ).toBe(403);
        expect(
            (
                await agent
                    .get('/api/terminal/config')
                    .set('Origin', 'http://evil.example')
            ).status
        ).toBe(403);
    });
    it('forwards WS handshake/head/payload after session and Origin checks without leaking credentials', async () => {
        const response = await upgrade('/terminal-proxy/ws?arg=unsafe', {
            echo: true,
            head: 'initial-data',
        });
        expect(response).toContain('101 Switching Protocols');
        expect(response).toContain('initial-data');
        expect(response).toContain('client-payload');
        expect(response).not.toContain('Set-Cookie');
        expect(lastUpgrade.url).toBe('/ws');
        expect(lastUpgrade.headers.cookie).toBeUndefined();
        expect(lastUpgrade.headers.authorization).toBeUndefined();
    });
    it('applies the external panel policy to upgrades', async () => {
        detachUpgrade();
        detachUpgrade = attachUpgrade(
            server,
            app.terminalSessionMiddleware,
            (req, res) => res.status(503).json({ error: 'Gate closed' })
        );
        expect(await upgrade()).toContain('503 Service Unavailable');
        expect(lastUpgrade).toBeUndefined();
    });
    it.each([
        '/terminal-proxy/%2e%2e/token',
        '/terminal-proxy/%2Ftoken',
        '/terminal-proxy/%5cfile',
        '/terminal-proxy/%252e%252e/token',
        '/terminal-proxy/%00',
        '/terminal-proxy/%zz',
    ])('rejects ambiguous/traversal paths %s', async (url) => {
        expect(await rawHttp(url)).toBe(404);
        expect(lastRequest).toBeUndefined();
    });
    it('rejects wrong WS paths, unmatched upgrades and unsafe HTTP methods', async () => {
        expect(await upgrade('/terminal-proxy/token')).toContain(
            '404 Not Found'
        );
        expect(await upgrade('/unrelated')).toContain('404 Not Found');
        expect(
            (
                await agent
                    .post('/terminal-proxy/')
                    .set('Origin', 'http://localhost')
            ).status
        ).toBe(405);
    });
    it('supports loopback HTTP upstream bases on HTTP and WS', async () => {
        const tcpUpstream = http.createServer((req, res) => res.end(req.url));
        const tcpSockets = new Set();
        tcpUpstream.on('connection', (socket) => {
            tcpSockets.add(socket);
            socket.on('close', () => tcpSockets.delete(socket));
        });
        tcpUpstream.on('upgrade', (req, socket) => {
            socket.write(
                'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'
            );
            lastUpgrade = req.url;
        });
        await listen(tcpUpstream, { host: '127.0.0.1', port: 0 });
        delete process.env.TERMINAL_SOCKET;
        process.env.TERMINAL_URL = `http://127.0.0.1:${tcpUpstream.address().port}/private`;
        try {
            expect((await agent.get('/terminal-proxy/token')).text).toBe(
                '/private/token'
            );
            expect(await upgrade()).toContain('101 Switching Protocols');
            expect(lastUpgrade).toBe('/private/ws');
        } finally {
            for (const socket of tcpSockets) socket.destroy();
            await close(tcpUpstream);
        }
    });
    it('keeps legacy project-aware socket launchers working with owned UID arguments only', async () => {
        process.env.CLAUDE_TERMINAL_SOCKET = process.env.TERMINAL_SOCKET;
        process.env.CLAUDE_TERMINAL_ALLOWED_EMAILS =
            process.env.TERMINAL_ALLOWED_EMAILS;
        delete process.env.TERMINAL_SOCKET;
        delete process.env.TERMINAL_ALLOWED_EMAILS;
        delete process.env.TERMINAL_ENABLED;
        expect((await agent.get('/api/terminal/config')).status).toBe(404);
        await Project.create({
            uid: 'legacy123',
            name: 'Owned workspace',
            user_id: user.id,
        });
        const other = await createTestUser({ email: 'other@example.com' });
        await Project.create({
            uid: 'other123',
            name: 'Other workspace',
            user_id: other.id,
        });
        expect((await agent.get('/api/terminal/config')).body.session_arg).toBe(
            'legacy123'
        );
        expect((await agent.get('/terminal-proxy/?arg=other123')).status).toBe(
            404
        );
        expect(
            (await agent.get('/terminal-proxy/?arg=legacy123&command=sh'))
                .status
        ).toBe(200);
        expect(lastRequest.url).toBe('/?arg=legacy123');
        expect(
            (await agent.get('/terminal-proxy?arg=legacy123')).headers.location
        ).toBe('/terminal-proxy/?arg=legacy123');
        expect(await upgrade('/terminal-proxy/ws?arg=other123')).toContain(
            '404 Not Found'
        );
        expect(await upgrade('/terminal-proxy/ws?arg=legacy123')).toContain(
            '101 Switching Protocols'
        );
        expect(lastUpgrade.url).toBe('/ws?arg=legacy123');
        process.env.TERMINAL_ENABLED = 'false';
        expect((await agent.get('/api/terminal/config')).status).toBe(404);
    });

    it('enforces a shared per-user HTTP/WS rate limit', async () => {
        for (let count = 0; count < 120; count++) {
            const response = await agent.get('/api/terminal/config');
            expect(response.status).toBe(200);
        }
        expect((await agent.get('/terminal-proxy/')).status).toBe(429);
        expect(await upgrade()).toContain('429 Too Many Requests');
        expect(lastRequest).toBeUndefined();
        expect(lastUpgrade).toBeUndefined();
    });

    it('returns a generic 502 if the private upstream is unavailable', async () => {
        process.env.TERMINAL_SOCKET = path.join(dir, 'missing.sock');
        expect((await agent.get('/terminal-proxy/')).status).toBe(502);
        expect(await upgrade()).toContain('502 Bad Gateway');
    });
});
