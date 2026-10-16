const request = require('supertest');
const app = require('../../app');
const { createTestUser } = require('../helpers/testUtils');

describe('Partial task update keeps status', () => {
    let agent;

    beforeEach(async () => {
        const user = await createTestUser();
        agent = request.agent(app);
        await agent
            .post('/api/login')
            .send({ email: user.email, password: 'password123' });
    });

    it.each([
        ['done', 2],
        ['in_progress', 1],
        ['waiting', 4],
    ])('a due_date-only PATCH keeps status %s', async (status, code) => {
        const created = await agent
            .post('/api/task')
            .send({ name: 'Plan item', status, due_date: '2026-11-20' });
        expect(created.status).toBe(201);
        const updated = await agent
            .patch(`/api/task/${created.body.uid}`)
            .send({ due_date: '2026-11-21' });
        expect(updated.status).toBe(200);
        expect([status, code]).toContain(updated.body.status);
    });
});
