const request = require('supertest');
const fs = require('fs');
const os = require('os');
const path = require('path');
const app = require('../../app');
const { createTestUser } = require('../helpers/testUtils');

const envNames = [
    'TERMINAL_ENABLED',
    'TERMINAL_SOCKET',
    'TERMINAL_ALLOWED_EMAILS',
    'TERMINAL_UPLOAD_DIR',
    'TERMINAL_UPLOAD_HOST_DIR',
];
const originalEnv = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]])
);
const endpoint = '/api/terminal/upload';
const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64'
);
const jpeg = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

describe('Terminal image upload', () => {
    let agent;
    let dir;
    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-upload-'));
        process.env.TERMINAL_ENABLED = 'true';
        process.env.TERMINAL_SOCKET = '/unused/ttyd.sock';
        process.env.TERMINAL_ALLOWED_EMAILS = 'TEST@example.com';
        process.env.TERMINAL_UPLOAD_DIR = dir;
        process.env.TERMINAL_UPLOAD_HOST_DIR = '/host/terminal-images';
        const user = await createTestUser();
        agent = request
            .agent(app)
            .set('Host', 'localhost')
            .set('Origin', 'http://localhost');
        const login = await agent
            .post('/api/login')
            .send({ email: user.email, password: 'password123' });
        if (login.status !== 200)
            throw new Error('Terminal upload test login failed');
    });
    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
        for (const name of envNames) {
            if (originalEnv[name] === undefined) delete process.env[name];
            else process.env[name] = originalEnv[name];
        }
    });
    const attach = (req, bytes = png, filename = 'client.png') =>
        req.attach('image', bytes, { filename, contentType: 'image/png' });

    it('requires a browser session and rejects Bearer with or without a session', async () => {
        const unauthenticated = await attach(request(app).post(endpoint));
        expect(unauthenticated.status).toBe(401);
        expect(unauthenticated.headers['cache-control']).toBe('no-store');
        const token = await agent
            .post('/api/profile/api-keys')
            .send({ name: 'Upload test' });
        expect(token.status).toBe(201);
        const authorization = `Bearer ${token.body.token}`;
        for (const client of [request(app), agent]) {
            const response = await attach(
                client.post(endpoint).set('Authorization', authorization)
            );
            expect(response.status).toBe(401);
            expect(response.headers['cache-control']).toBe('no-store');
        }
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('denies users outside the allowlist', async () => {
        process.env.TERMINAL_ALLOWED_EMAILS = 'other@example.com';
        const response = await attach(agent.post(endpoint));
        expect(response.status).toBe(403);
        expect((await agent.get('/api/terminal/config')).status).toBe(403);
    });

    it.each(envNames)('disables upload when %s is missing', async (name) => {
        delete process.env[name];
        expect((await attach(agent.post(endpoint))).status).toBe(404);
        expect(
            (await agent.get('/api/terminal/config')).body.upload_enabled
        ).not.toBe(true);
    });

    it.each([
        'https://other.example',
        'null',
        'invalid',
        'ftp://localhost',
        'http://localhost:9999',
    ])('rejects an invalid or mismatched Origin: %s', async (origin) => {
        expect(
            (
                await attach(
                    agent
                        .post(endpoint)
                        .set('Host', 'localhost')
                        .set('Origin', origin)
                )
            ).status
        ).toBe(403);
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('accepts a same-host Origin and reports config upload_enabled', async () => {
        const config = await agent.get('/api/terminal/config');
        expect(config.body).toMatchObject({
            enabled: true,
            upload_enabled: true,
        });
        expect(config.headers['cache-control']).toBe('no-store');
        expect(
            (
                await attach(
                    agent
                        .post(endpoint)
                        .set('Host', 'localhost:1234')
                        .set('Origin', 'http://localhost:1234')
                )
            ).status
        ).toBe(200);
    });

    it('rejects a text file disguised as a PNG and empty/truncated signatures', async () => {
        for (const bytes of [
            Buffer.from('not an image'),
            Buffer.alloc(0),
            png.subarray(0, 7),
            Buffer.from('GIF89a').map((byte) => byte | 0x80),
        ]) {
            expect(
                (await attach(agent.post(endpoint), bytes, 'fake.png')).status
            ).toBe(415);
        }
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('limits upload attempts before accepting multipart data', async () => {
        for (let count = 0; count < 20; count++) {
            expect((await agent.post(endpoint)).status).toBe(400);
        }
        expect((await attach(agent.post(endpoint))).status).toBe(429);
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('requires an Origin for uploads even with a valid session', async () => {
        expect(
            (await attach(agent.post(endpoint).unset('Origin'))).status
        ).toBe(403);
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('limits each file to 15 MB', async () => {
        const response = await attach(
            agent.post(endpoint),
            Buffer.alloc(15 * 1024 * 1024 + 1)
        );
        expect(response.status).toBe(413);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('accepts an image of exactly 15 MB', async () => {
        const bytes = Buffer.concat([
            png,
            Buffer.alloc(15 * 1024 * 1024 - png.length),
        ]);
        const response = await attach(agent.post(endpoint), bytes);
        expect(response.status).toBe(200);
        expect(fs.readdirSync(dir)).toHaveLength(1);
    });

    it.each([
        '/host/claude images',
        '/host/x\ny',
        '/host/../other',
        '/host/./other',
        '/host//other',
        '/host/\u001b[201~',
        'relative/dir',
    ])(
        'disables upload when the host path is not a plain absolute path: %p',
        async (hostDir) => {
            process.env.TERMINAL_UPLOAD_HOST_DIR = hostDir;
            expect(
                (await agent.get('/api/terminal/config')).body.upload_enabled
            ).not.toBe(true);
            expect((await attach(agent.post(endpoint))).status).toBe(404);
            expect(fs.readdirSync(dir)).toEqual([]);
        }
    );

    it('requires exactly one image field', async () => {
        expect((await agent.post(endpoint)).status).toBe(400);
        expect(
            (await agent.post(endpoint).attach('other', png, 'image.png'))
                .status
        ).toBe(400);
        expect((await attach(attach(agent.post(endpoint)))).status).toBe(400);
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it.each([
        ['png', png],
        ['jpg', jpeg],
        ['gif', Buffer.from('GIF89a')],
        ['webp', Buffer.from('524946460400000057454250', 'hex')],
    ])(
        'detects %s bytes, saves atomically with 0640 and returns the host path',
        async (ext, bytes) => {
            const response = await agent.post(endpoint).attach('image', bytes, {
                filename: '../../untrusted.svg',
                contentType: 'text/plain',
            });
            expect(response.status).toBe(200);
            const name = path.basename(response.body.path);
            expect(name).toMatch(
                new RegExp(`^\\d{8}-\\d{6}-[a-f0-9]{8}\\.${ext}$`)
            );
            expect(response.body.path).toBe(
                path.join('/host/terminal-images', name)
            );
            expect(response.headers['cache-control']).toBe('no-store');
            expect(fs.readdirSync(dir)).toEqual([name]);
            expect(fs.readFileSync(path.join(dir, name))).toEqual(bytes);
            expect(fs.statSync(path.join(dir, name)).mode & 0o777).toBe(0o640);
        }
    );

    it('prunes only matching regular files older than 30 days', async () => {
        const oldName = '20200101-010101-deadbeef.png';
        const recentName = '20261003-010101-12345678.jpg';
        const unrelated = [
            'notes.png',
            '20200101-010101-deadbeef.txt',
            '.partial.tmp',
        ];
        const oldTime = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
        for (const name of [oldName, recentName, ...unrelated]) {
            fs.writeFileSync(path.join(dir, name), png);
            if (name !== recentName)
                fs.utimesSync(path.join(dir, name), oldTime, oldTime);
        }
        const directoryName = '20200101-010101-12345678.gif';
        fs.mkdirSync(path.join(dir, directoryName));
        const linkName = '20200101-010101-87654321.png';
        fs.symlinkSync(path.join(dir, unrelated[0]), path.join(dir, linkName));
        // A rejected upload must not trigger retention cleanup.
        expect(
            (await attach(agent.post(endpoint), Buffer.from('text'))).status
        ).toBe(415);
        expect(fs.existsSync(path.join(dir, oldName))).toBe(true);
        expect((await attach(agent.post(endpoint))).status).toBe(200);
        expect(fs.existsSync(path.join(dir, oldName))).toBe(false);
        for (const name of [
            recentName,
            ...unrelated,
            directoryName,
            linkName,
        ]) {
            expect(fs.existsSync(path.join(dir, name))).toBe(true);
        }
    });
});
