const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const {
    createPanelAccess,
    fromEnvironment,
} = require('../../../services/panelAccess.cjs');

const config = {
    publicOrigin: 'https://panel.example.test',
    issuer: 'https://identity.example.test',
    jwksUrl: 'https://identity.example.test/keys',
    audience: 'tududi-panel',
    ownerEmail: 'owner@example.test',
    tokenHeader: 'x-panel-access-token',
};
const now = Math.floor(Date.now() / 1000);
let jose, privateKey, keySet;
before(async () => {
    jose = await import('jose');
    const pair = await jose.generateKeyPair('RS256');
    privateKey = pair.privateKey;
    keySet = jose.createLocalJWKSet({
        keys: [
            {
                ...(await jose.exportJWK(pair.publicKey)),
                kid: 'test-key',
                alg: 'RS256',
            },
        ],
    });
});

async function token(overrides = {}) {
    return new jose.SignJWT({
        iss: config.issuer,
        aud: config.audience,
        sub: 'test-owner',
        email: config.ownerEmail,
        iat: now,
        exp: now + 300,
        ...overrides,
    })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .sign(privateKey);
}
function request(host = '127.0.0.1:9393', headers = {}, path = '/api/health') {
    return {
        headers: { host, ...headers },
        path,
        method: 'GET',
        session: { cookie: { secure: true } },
    };
}
async function invoke(gate, req) {
    const result = { next: false, status: 200, headers: {}, body: null };
    const res = {
        setHeader(name, value) {
            result.headers[name] = value;
        },
        status(code) {
            result.status = code;
            return this;
        },
        json(body) {
            result.body = body;
            return this;
        },
        end() {
            return this;
        },
    };
    await gate.middleware(req, res, () => {
        result.next = true;
    });
    return result;
}
async function withEnvironment(values, run) {
    const old = {};
    for (const [name, value] of Object.entries(values)) {
        old[name] = process.env[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    try {
        return await run();
    } finally {
        for (const [name, value] of Object.entries(old)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
}

test('Pixel Office private-only mode accepts the exact upstream Host and resets Secure for HTTP', async () => {
    await withEnvironment(
        { PORT: '9393', PANEL_ACCESS_ENABLED: 'false' },
        async () => {
            const gate = fromEnvironment();
            const req = request();
            assert.equal((await invoke(gate, req)).next, true);
            assert.equal(req.session.cookie.secure, false);
            for (const host of [
                '127.0.0.1:9394',
                'localhost:9393',
                '192.0.2.10:9393',
                '127.0.0.1:9393.',
                '127.0.0.1:9393 ',
            ]) {
                assert.equal(
                    (await invoke(gate, request(host))).status,
                    503,
                    host
                );
            }
        }
    );
});

test('forwarded headers, missing Host and duplicate Host never gain the private bypass', async () => {
    await withEnvironment(
        { PORT: '9393', PANEL_ACCESS_ENABLED: 'false' },
        async () => {
            const gate = fromEnvironment();
            for (const headers of [
                { 'x-forwarded-host': '' },
                { 'x-panel-access-token': '' },
            ]) {
                assert.equal(
                    (await invoke(gate, request(undefined, headers))).status,
                    503
                );
            }
            const missing = request();
            delete missing.headers.host;
            assert.equal((await invoke(gate, missing)).status, 503);
            const duplicate = request();
            duplicate.rawHeaders = [
                'Host',
                '127.0.0.1:9393',
                'Host',
                'panel.example.test',
            ];
            assert.equal((await invoke(gate, duplicate)).status, 503);
        }
    );
});

test('the optional gate can be left unconfigured for ordinary Tududi deployments', async () => {
    await withEnvironment({ PANEL_ACCESS_ENABLED: undefined }, async () => {
        assert.equal(
            (await invoke(fromEnvironment(), request('tasks.example.test')))
                .next,
            true
        );
    });
});

test('missing configuration and disabled TLS verification fail closed for external traffic', async () => {
    for (const tls of [undefined, '0']) {
        await withEnvironment(
            {
                PANEL_ACCESS_ENABLED: 'true',
                PANEL_PUBLIC_ORIGIN: undefined,
                NODE_TLS_REJECT_UNAUTHORIZED: tls,
            },
            async () => {
                const response = await invoke(
                    fromEnvironment(),
                    request('panel.example.test')
                );
                assert.equal(response.status, 503);
                assert.equal(response.next, false);
                assert.equal(response.headers['Cache-Control'], 'no-store');
            }
        );
    }
});

test('a valid generic signed identity still leaves normal Tududi authentication to the API', async () => {
    const gate = await createPanelAccess(config, {
        keySet,
        clock: () => now * 1000,
        audit: () => {},
    });
    const req = request(
        'panel.example.test',
        { 'x-forwarded-proto': 'https', 'x-panel-access-token': await token() },
        '/api/tasks'
    );
    const result = await invoke(gate, req);
    assert.equal(result.next, true);
    assert.equal(req.session.cookie.secure, true);
    assert.equal(req.session.userId, undefined);
    assert.equal(result.headers['X-Frame-Options'], 'DENY');
});

test('invalid issuer, audience, owner, time or signature is rejected', async () => {
    const gate = await createPanelAccess(config, {
        keySet,
        clock: () => now * 1000,
        audit: () => {},
    });
    for (const claims of [
        { iss: 'https://wrong.example.test' },
        { aud: 'other-app' },
        { email: 'other@example.test' },
        { exp: now - 1 },
        { iat: now + 10 },
        { sub: '' },
        { email: undefined },
    ]) {
        const response = await invoke(
            gate,
            request('panel.example.test', {
                'x-forwarded-proto': 'https',
                'x-panel-access-token': await token(claims),
            })
        );
        assert.equal(response.status, 403);
        assert.equal(response.next, false);
    }
    const signed = await token();
    const parts = signed.split('.');
    parts[2] = `${parts[2][0] === 'a' ? 'b' : 'a'}${parts[2].slice(1)}`;
    assert.equal(
        (
            await invoke(
                gate,
                request('panel.example.test', {
                    'x-forwarded-proto': 'https',
                    'x-panel-access-token': parts.join('.'),
                })
            )
        ).status,
        403
    );
});

test('public host, forwarded HTTPS and identity token are all mandatory', async () => {
    const gate = await createPanelAccess(config, {
        keySet,
        clock: () => now * 1000,
        audit: () => {},
    });
    const headers = {
        'x-forwarded-proto': 'https',
        'x-panel-access-token': await token(),
    };
    assert.equal(
        (await invoke(gate, request('other.example.test', headers))).status,
        403
    );
    assert.equal(
        (
            await invoke(
                gate,
                request('panel.example.test', {
                    ...headers,
                    'x-forwarded-proto': 'http',
                })
            )
        ).status,
        403
    );
    assert.equal(
        (
            await invoke(
                gate,
                request('panel.example.test', { 'x-forwarded-proto': 'https' })
            )
        ).status,
        403
    );
});

test('external registration stays blocked across encoded and versioned API paths', async () => {
    const gate = await createPanelAccess(config, {
        keySet,
        clock: () => now * 1000,
        audit: () => {},
    });
    const headers = {
        'x-forwarded-proto': 'https',
        'x-panel-access-token': await token(),
    };
    for (const path of [
        '/api/register',
        '/api/v1/VERIFY-EMAIL',
        '/api//%72egister',
        '/api/v1%2fregister',
        '/api/register;ignored',
        '/api/%',
    ]) {
        assert.equal(
            (await invoke(gate, request('panel.example.test', headers, path)))
                .status,
            403,
            path
        );
    }
    assert.equal(
        (
            await invoke(
                gate,
                request('panel.example.test', headers, '/api/login')
            )
        ).next,
        true
    );
});

test('plain HTTP key URLs and reserved identity headers cannot enable the gate', async () => {
    for (const change of [
        { jwksUrl: 'http://identity.example.test/keys' },
        { publicOrigin: 'https://panel.example.test/path' },
        { tokenHeader: 'authorization' },
    ]) {
        await assert.rejects(
            createPanelAccess({ ...config, ...change }, { keySet })
        );
    }
});
