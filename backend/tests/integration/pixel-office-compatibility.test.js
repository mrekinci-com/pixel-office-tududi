const request = require('supertest');
const previousPanel = process.env.PANEL_ACCESS_ENABLED;
const previousPort = process.env.PORT;
process.env.PANEL_ACCESS_ENABLED = 'false';
process.env.PORT = '9393';
const app = require('../../app');
const { Role } = require('../../models');
const { createTestUser } = require('../helpers/testUtils');
const upstreamHost = '127.0.0.1:9393';

function api(method, path, token) {
    const req = request(app)[method](path).set('Host', upstreamHost);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
}
function sessionApi(agent, method, path) {
    return agent[method](path).set('Host', upstreamHost);
}

afterAll(() => {
    if (previousPanel === undefined) delete process.env.PANEL_ACCESS_ENABLED;
    else process.env.PANEL_ACCESS_ENABLED = previousPanel;
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
});

test('office account, API key and work record flow retains its API contract', async () => {
    expect((await api('get', '/api/version')).body.version).toBe('0.87-po.4');
    const owner = await createTestUser({ email: 'office-owner@example.test' });
    await Role.destroy({ where: {} });
    await Role.create({ user_id: owner.id, is_admin: true });
    const admin = request.agent(app);
    const login = await sessionApi(admin, 'post', '/api/login').send({
        email: owner.email,
        password: 'password123',
    });
    expect(login.status).toBe(200);
    expect(login.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(login.headers['set-cookie'][0]).not.toMatch(/; Secure(?:;|$)/i);

    const email = 'office-agent@example.test';
    const createdUser = await sessionApi(
        admin,
        'post',
        '/api/admin/users'
    ).send({ email, password: 'password123', name: 'Ajan', surname: 'Ofis' });
    expect(createdUser.status).toBe(201);
    expect(typeof createdUser.body.id).toBe('number');
    const id = createdUser.body.id;
    const users = await sessionApi(admin, 'get', '/api/admin/users');
    expect(users.body.find((row) => row.email === email).id).toBe(id);
    expect(
        (
            await sessionApi(admin, 'post', '/api/admin/users').send({
                email,
                password: 'password123',
            })
        ).status
    ).toBe(409);

    const agent = request.agent(app);
    expect(
        (
            await sessionApi(agent, 'post', '/api/login').send({
                email,
                password: 'password123',
            })
        ).status
    ).toBe(200);
    const key = await sessionApi(agent, 'post', '/api/profile/api-keys').send({
        name: 'Pixel Office',
    });
    expect(key.status).toBe(201);
    expect(key.body.token).toMatch(/^tt_/);
    const token = key.body.token;
    expect((await api('get', '/api/admin/users', token)).status).toBe(403);
    expect((await api('get', '/api/profile', token)).body.language).toBe('en');

    expect(
        (
            await api('patch', '/api/profile', token).send({
                language: 'tr',
                timezone: 'Europe/Istanbul',
            })
        ).status
    ).toBe(200);
    expect((await api('get', '/api/profile', token)).body).toMatchObject({
        language: 'tr',
        timezone: 'Europe/Istanbul',
    });
    const project = await api('post', '/api/project', token).send({
        name: 'Ofis işleri',
    });
    expect(project.status).toBe(201);
    expect(project.body.uid).toBeTruthy();
    const projectUid = project.body.uid;
    expect(
        (
            await api('patch', `/api/project/${projectUid}`, token).send({
                name: 'Ofis kayıtları',
                description: 'Güncel açıklama',
            })
        ).status
    ).toBe(200);

    const task = await api('post', '/api/task', token).send({
        name: 'Rapor',
        note: 'İlk not',
        project_uid: projectUid,
        status: 2,
    });
    expect(task.status).toBe(201);
    expect(task.body.uid).toBeTruthy();
    const taskUid = task.body.uid;
    const originalStatus = task.body.status;
    expect([2, 'done']).toContain(originalStatus);
    for (const fields of [
        { name: 'Rapor güncellendi' },
        { note: 'Yeni not' },
        { due_date: '2026-11-20' },
    ]) {
        const updated = await api('patch', `/api/task/${taskUid}`, token).send(
            fields
        );
        expect(updated.status).toBe(200);
        expect(updated.body.status).toBe(originalStatus);
    }
    const note = await api('post', '/api/note', token).send({
        title: 'Günlük kayıt',
        content: 'Özet',
        project_uid: projectUid,
    });
    expect(note.status).toBe(201);
    const noteUid = note.body.uid;
    expect(
        (
            await api('patch', `/api/note/${noteUid}`, token).send({
                title: 'Günlük kayıt',
                content: 'Güncel özet',
                project_uid: projectUid,
            })
        ).status
    ).toBe(200);

    const [projects, tasks, notes] = await Promise.all([
        api('get', '/api/projects', token),
        api('get', '/api/tasks?type=all&client_side_filtering=true', token),
        api('get', '/api/notes', token),
    ]);
    expect(projects.status).toBe(200);
    expect(tasks.status).toBe(200);
    expect(notes.status).toBe(200);
    expect(
        (projects.body.projects || projects.body).find(
            (row) => row.uid === projectUid
        ).name
    ).toBe('Ofis kayıtları');
    expect(tasks.body.tasks.find((row) => row.uid === taskUid)).toMatchObject({
        note: 'Yeni not',
        status: originalStatus,
    });
    const storedNote = notes.body.find((row) => row.uid === noteUid);
    expect(storedNote.content).toBe('Güncel özet');
    expect(storedNote.Project.uid).toBe(projectUid);
    expect((await api('get', '/api/search?q=Rapor', token)).status).toBe(200);
    expect((await api('get', '/api/v1/projects', token)).status).toBe(200);

    // The agent's private data is not returned through the owner's session.
    expect(
        (await sessionApi(admin, 'get', '/api/notes')).body.some(
            (row) => row.uid === noteUid
        )
    ).toBe(false);
    expect(
        (
            await sessionApi(admin, 'put', `/api/admin/users/${id}`).send({
                password: 'replacement-password',
            })
        ).status
    ).toBe(200);
    expect(
        (
            await api('post', '/api/login').send({
                email,
                password: 'replacement-password',
            })
        ).status
    ).toBe(200);
    expect(
        (await sessionApi(admin, 'delete', `/api/admin/users/${id}`)).status
    ).toBe(204);
    expect((await api('get', '/api/projects', token)).status).toBe(401);
});
