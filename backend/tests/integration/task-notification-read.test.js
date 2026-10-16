const request = require('supertest');
const app = require('../../app');
const { Op } = require('sequelize');
const {
    Task,
    Notification,
    RecurringCompletion,
    sequelize,
} = require('../../models');
const taskRepository = require('../../repositories/TaskRepository');
const { createTestUser } = require('../helpers/testUtils');
const { checkDueTasks } = require('../../services/dueTaskService');
const { checkDeferredTasks } = require('../../services/deferredTaskService');
const { calculateNextDueDate } = require('../../services/recurringTaskService');
const migration = require('../../migrations/20261006000001-read-completed-task-notifications');

const logService = require('../../services/logService');

describe('Task notifications follow task completion', () => {
    let user, agent, task, logError;

    const notify = (target = task, attributes = {}) =>
        Notification.create({
            user_id: target.user_id,
            type: 'task_due_soon',
            title: 'Task reminder',
            data: { taskUid: target.uid },
            ...attributes,
        });

    const expectRead = async (notification) => {
        await notification.reload();
        expect(notification.read_at).toBeInstanceOf(Date);
    };

    beforeEach(async () => {
        logError = jest
            .spyOn(logService, 'logError')
            .mockImplementation(() => {});
        await Notification.destroy({ where: {} });
        await RecurringCompletion.destroy({ where: {} });
        user = await createTestUser();
        task = await Task.create({ name: 'Task', user_id: user.id });
    });

    describe('Database lifecycle', () => {
        it('ignores malformed JSON while marking matching reminders read on completion', async () => {
            const matching = await notify();
            const malformed = await notify();
            await sequelize.query(
                'UPDATE notifications SET data = :data WHERE id = :id',
                { replacements: { data: '{bad json', id: malformed.id } }
            );

            await task.update({ status: Task.STATUS.DONE });

            await task.reload();
            expect(task.status).toBe(Task.STATUS.DONE);
            await expectRead(matching);
            const [rows] = await sequelize.query(
                'SELECT read_at FROM notifications WHERE id = :id',
                { replacements: { id: malformed.id } }
            );
            expect(rows[0].read_at).toBeNull();
            expect(logError).not.toHaveBeenCalled();
        });

        it.each([
            'update',
            'bulkUpdate',
            'destroy',
            'bulkDestroy',
            'recurring',
            'bulkRecurring',
        ])(
            'logs notification failures without failing transactional %s',
            async (operation) => {
                const notification = await notify();
                const failure = new Error('Notification storage unavailable');
                jest.spyOn(Notification, 'update').mockRejectedValue(failure);

                await sequelize.transaction(async (transaction) => {
                    const options = { transaction };
                    if (operation === 'update')
                        await task.update(
                            { status: Task.STATUS.DONE },
                            options
                        );
                    if (operation === 'bulkUpdate')
                        await Task.update(
                            { status: Task.STATUS.DONE },
                            { ...options, where: { id: task.id } }
                        );
                    if (operation === 'destroy') await task.destroy(options);
                    if (operation === 'bulkDestroy')
                        await Task.destroy({
                            ...options,
                            where: { id: task.id },
                        });
                    const values = {
                        task_id: task.id,
                        completed_at: new Date(),
                        original_due_date: new Date(),
                    };
                    if (operation === 'recurring')
                        await RecurringCompletion.create(values, options);
                    if (operation === 'bulkRecurring')
                        await RecurringCompletion.bulkCreate([values], options);
                });

                expect(logError).toHaveBeenCalledWith(
                    expect.any(String),
                    failure
                );
                const persisted = await Task.findByPk(task.id);
                const expectedStatus = {
                    update: Task.STATUS.DONE,
                    bulkUpdate: Task.STATUS.DONE,
                    destroy: undefined,
                    bulkDestroy: undefined,
                    recurring: Task.STATUS.NOT_STARTED,
                    bulkRecurring: Task.STATUS.NOT_STARTED,
                };
                expect(persisted?.status).toBe(expectedStatus[operation]);
                expect(await RecurringCompletion.count()).toBe(
                    ['recurring', 'bulkRecurring'].includes(operation) ? 1 : 0
                );
                await notification.reload();
                expect(notification.read_at).toBeNull();
            }
        );

        it('marks date reminders read when the due date moves later or is removed, and keeps them otherwise', async () => {
            const day = (n) => new Date(Date.UTC(2026, 9, n, 9, 0, 0));
            await task.update({ due_date: day(10) });
            const soon = await notify();
            const overdue = await notify(task, { type: 'task_overdue' });
            const assigned = await notify(task, { type: 'task_assigned' });
            const other = await Task.create({
                name: 'Other',
                user_id: user.id,
                due_date: day(10),
            });
            const otherOverdue = await notify(other, { type: 'task_overdue' });

            // An unrelated edit and an earlier date keep the reminders.
            await task.update({ name: 'Renamed' });
            await task.update({ due_date: day(9) });
            for (const n of [soon, overdue]) {
                await n.reload();
                expect(n.read_at).toBeNull();
            }

            await task.update({ due_date: day(12) });
            await expectRead(soon);
            await expectRead(overdue);
            for (const n of [assigned, otherOverdue]) {
                await n.reload();
                expect(n.read_at).toBeNull();
            }

            // Removing the date also clears a fresh reminder.
            const again = await notify(task, { type: 'task_overdue' });
            await task.update({ due_date: null });
            await expectRead(again);

            // Bulk updates run the same rule.
            const bulk = await notify(other, { type: 'task_due_soon' });
            await Task.update(
                { due_date: day(20) },
                { where: { id: other.id } }
            );
            await expectRead(bulk);
            await expectRead(otherOverdue);
            expect(logError).not.toHaveBeenCalled();
        });

        it('does not fail recurring completion when its notification task lookup fails', async () => {
            const failure = new Error('Notification lookup unavailable');
            jest.spyOn(Task, 'findByPk').mockRejectedValueOnce(failure);
            await RecurringCompletion.create({
                task_id: task.id,
                completed_at: new Date(),
                original_due_date: new Date(),
            });
            expect(await RecurringCompletion.count()).toBe(1);
            expect(logError).toHaveBeenCalledWith(expect.any(String), failure);
        });

        describe.each([
            ['due', checkDueTasks],
            ['deferred', checkDeferredTasks],
        ])('%s scheduler races', (name, checkTasks) => {
            it.each([new Date(Date.now() + 7 * 86400000), null])(
                'skips a task whose due date changes to %s after the initial read',
                async (dueDate) => {
                    await task.update({
                        due_date: new Date(Date.now() - 3600000),
                        defer_until: new Date(Date.now() - 3600000),
                    });
                    const findAll = Task.findAll.bind(Task);
                    jest.spyOn(Task, 'findAll').mockImplementationOnce(
                        async (options) => {
                            const snapshot = await findAll(options);
                            expect(snapshot).toHaveLength(1);
                            await task.update({ due_date: dueDate });
                            return snapshot;
                        }
                    );

                    expect(await checkTasks()).toEqual({
                        success: true,
                        tasksProcessed: 1,
                        notificationsCreated: 0,
                    });
                    expect(await Notification.count()).toBe(0);
                    expect(logError).not.toHaveBeenCalled();
                }
            );

            it.each([false, true])(
                'skips a completed weekly occurrence after the initial read (advance=%s)',
                async (advance) => {
                    // Both weekly occurrences are overdue, so the next run can
                    // prove that a reminder for the new occurrence still works.
                    const originalDueDate = new Date(Date.now() - 8 * 86400000);
                    await task.update({
                        recurrence_type: 'weekly',
                        recurrence_interval: 1,
                        due_date: originalDueDate,
                        defer_until: originalDueDate,
                    });
                    const nextDueDate = calculateNextDueDate(
                        task,
                        originalDueDate
                    );
                    const oldNotification = await notify(task, {
                        type: name === 'due' ? 'task_overdue' : 'task_due_soon',
                        data: {
                            taskUid: task.uid,
                            dueDate: originalDueDate,
                            ...(name === 'deferred'
                                ? { reason: 'defer_until_reached' }
                                : {}),
                        },
                        created_at: new Date(Date.now() - 3 * 86400000),
                    });
                    const findAll = Task.findAll.bind(Task);
                    jest.spyOn(Task, 'findAll').mockImplementationOnce(
                        async (options) => {
                            const snapshot = await findAll(options);
                            expect(snapshot).toHaveLength(1);
                            // Commit completion between the scheduler's initial
                            // read and its transaction, leaving the task open.
                            await sequelize.transaction(async (transaction) => {
                                if (advance) {
                                    await task.update(
                                        {
                                            due_date: nextDueDate,
                                            defer_until: nextDueDate,
                                        },
                                        { transaction }
                                    );
                                }
                                await RecurringCompletion.create(
                                    {
                                        task_id: task.id,
                                        completed_at: new Date(),
                                        original_due_date: originalDueDate,
                                    },
                                    { transaction }
                                );
                            });
                            return snapshot;
                        }
                    );

                    expect(await checkTasks()).toEqual({
                        success: true,
                        tasksProcessed: 1,
                        notificationsCreated: 0,
                    });
                    await task.reload();
                    expect(task.status).toBe(Task.STATUS.NOT_STARTED);
                    expect(task.due_date).toEqual(
                        advance ? nextDueDate : originalDueDate
                    );
                    await expectRead(oldNotification);
                    expect(await Notification.count()).toBe(1);
                    expect(
                        await Notification.count({ where: { read_at: null } })
                    ).toBe(0);

                    if (!advance) {
                        await task.update({
                            due_date: nextDueDate,
                            defer_until: nextDueDate,
                        });
                    }
                    expect((await checkTasks()).notificationsCreated).toBe(1);
                    const newNotification = await Notification.findOne({
                        where: { read_at: null },
                    });
                    expect(
                        new Date(
                            name === 'due'
                                ? newNotification.data.dueDate
                                : newNotification.data.deferUntil
                        )
                    ).toEqual(nextDueDate);
                    expect(logError).not.toHaveBeenCalled();
                }
            );

            it.each(['completed', 'archived', 'deleted'])(
                'skips a task %s after the initial read',
                async (transition) => {
                    await task.update({
                        due_date: new Date(),
                        defer_until: new Date(),
                    });
                    const findAll = Task.findAll.bind(Task);
                    jest.spyOn(Task, 'findAll').mockImplementationOnce(
                        async (options) => {
                            const snapshot = await findAll(options);
                            expect(snapshot).toHaveLength(1);
                            if (transition === 'deleted') await task.destroy();
                            else
                                await task.update({
                                    status:
                                        transition === 'completed'
                                            ? Task.STATUS.DONE
                                            : Task.STATUS.ARCHIVED,
                                });
                            return snapshot;
                        }
                    );

                    const result = await checkTasks();

                    expect(result).toEqual({
                        success: true,
                        tasksProcessed: 1,
                        notificationsCreated: 0,
                    });
                    expect(await Notification.count()).toBe(0);
                    expect(logError).not.toHaveBeenCalled();
                }
            );

            it('creates reminders for active tasks and rolls back a failed notification write', async () => {
                await task.update({
                    due_date: new Date(),
                    defer_until: new Date(),
                });
                const createNotification =
                    Notification.createNotification.bind(Notification);
                const failure = new Error('Failure after notification insert');
                jest.spyOn(
                    Notification,
                    'createNotification'
                ).mockImplementationOnce(async (...args) => {
                    await createNotification(...args);
                    throw failure;
                });
                expect((await checkTasks()).notificationsCreated).toBe(0);
                expect(await Notification.count()).toBe(0);
                expect(logError).toHaveBeenCalledWith(
                    expect.any(String),
                    failure
                );

                expect((await checkTasks()).notificationsCreated).toBe(1);
                expect(
                    await Notification.count({ where: { read_at: null } })
                ).toBe(1);
            });
        });

        it.each([
            'task_due_soon',
            'task_overdue',
            'task_assigned',
            'task_completed',
        ])(
            'handles %s while preserving other users, tasks and notification types',
            async (type) => {
                const otherUser = await createTestUser({
                    email: 'other@example.com',
                });
                const otherTask = await Task.create({
                    name: 'Other task',
                    user_id: user.id,
                });
                const notification = await notify(task, { type });
                const deferred = await notify(task, {
                    data: { taskUid: task.uid, reason: 'defer_until_reached' },
                });
                const dismissed = await notify(task, {
                    dismissed_at: new Date(),
                });
                const originalReadAt = new Date('2026-01-01T12:00:00Z');
                const alreadyRead = await notify(task, {
                    read_at: originalReadAt,
                });
                const unaffected = await Promise.all([
                    notify(task, { user_id: otherUser.id }),
                    notify(otherTask),
                    notify(task, { type: 'project_due_soon' }),
                    notify(task, { type: 'project_overdue' }),
                    notify(task, { type: 'system' }),
                    notify(task, { data: null }),
                    notify(task, {
                        data: { taskUid: `${task.uid}-different` },
                    }),
                ]);

                // Instance save is also used outside the HTTP routes.
                task.status = Task.STATUS.DONE;
                await task.save();
                for (const item of [notification, deferred, dismissed]) {
                    await expectRead(item);
                }
                await alreadyRead.reload();
                expect(alreadyRead.read_at).toEqual(originalReadAt);
                for (const item of unaffected) {
                    await item.reload();
                    expect(item.read_at).toBeNull();
                }
            }
        );

        it.each([Task.STATUS.DONE, Task.STATUS.ARCHIVED])(
            'handles repository bulk updates to status %s with a status filter',
            async (status) => {
                const second = await Task.create({
                    name: 'Second',
                    user_id: user.id,
                });
                const outside = await Task.create({
                    name: 'Outside bulk selection',
                    user_id: user.id,
                    status: Task.STATUS.IN_PROGRESS,
                });
                const notifications = [await notify(), await notify(second)];
                const untouched = await notify(outside);
                await taskRepository.bulkUpdate(
                    { status },
                    {
                        where: {
                            user_id: user.id,
                            status: Task.STATUS.NOT_STARTED,
                        },
                    }
                );
                for (const item of notifications) await expectRead(item);
                await untouched.reload();
                expect(untouched.read_at).toBeNull();
            }
        );

        it('keeps skipped recurring occurrences unread and handles bulk completion records', async () => {
            const notification = await notify();
            const values = {
                task_id: task.id,
                completed_at: new Date(),
                original_due_date: new Date(),
            };
            await RecurringCompletion.create({ ...values, skipped: true });
            await notification.reload();
            expect(notification.read_at).toBeNull();
            await RecurringCompletion.bulkCreate([
                { ...values, skipped: false },
            ]);
            await expectRead(notification);
        });

        it('handles instance deletion and bulk deletion with user isolation', async () => {
            const notification = await notify();
            await task.destroy();
            await expectRead(notification);
            const selected = await Task.create({
                name: 'Selected',
                user_id: user.id,
            });
            const otherUser = await createTestUser({
                email: 'other@example.com',
            });
            const outside = await Task.create({
                name: 'Outside',
                user_id: otherUser.id,
            });
            const selectedNotification = await notify(selected);
            const outsideNotification = await notify(outside);
            await Task.destroy({ where: { user_id: user.id } });
            await expectRead(selectedNotification);
            await outsideNotification.reload();
            expect(outsideNotification.read_at).toBeNull();
        });

        it.each([
            'update',
            'bulkUpdate',
            'destroy',
            'bulkDestroy',
            'recurring',
        ])(
            'rolls back read state along with a transactional %s',
            async (operation) => {
                const notification = await notify();
                await expect(
                    sequelize.transaction(async (transaction) => {
                        const options = { transaction };
                        if (operation === 'update')
                            await task.update({ status: 2 }, options);
                        if (operation === 'bulkUpdate')
                            await Task.update(
                                { status: 2 },
                                { ...options, where: { id: task.id } }
                            );
                        if (operation === 'destroy')
                            await task.destroy(options);
                        if (operation === 'bulkDestroy')
                            await Task.destroy({
                                ...options,
                                where: { id: task.id },
                            });
                        if (operation === 'recurring')
                            await RecurringCompletion.create(
                                {
                                    task_id: task.id,
                                    completed_at: new Date(),
                                    original_due_date: new Date(),
                                },
                                options
                            );
                        await notification.reload(options);
                        expect(notification.read_at).toBeInstanceOf(Date);
                        throw new Error('Rollback test');
                    })
                ).rejects.toThrow('Rollback test');
                await notification.reload();
                expect(notification.read_at).toBeNull();
                const persisted = await Task.findByPk(task.id);
                expect(persisted.status).toBe(Task.STATUS.NOT_STARTED);
            }
        );

        it.each([Task.STATUS.DONE, Task.STATUS.ARCHIVED])(
            'does not create due or deferred notifications for status %s',
            async (status) => {
                await task.update({
                    status,
                    due_date: new Date(),
                    defer_until: new Date(),
                });
                expect((await checkDueTasks()).notificationsCreated).toBe(0);
                expect((await checkDeferredTasks()).notificationsCreated).toBe(
                    0
                );
                expect(await Notification.count()).toBe(0);
            }
        );

        it('keeps scheduler deduplication after reopening and creates a fresh reminder after its window', async () => {
            await task.update({ due_date: new Date(Date.now() - 3600000) });
            expect((await checkDueTasks()).notificationsCreated).toBe(1);
            const notification = await Notification.findOne({
                where: { user_id: user.id },
            });
            await task.update({ status: Task.STATUS.DONE });
            await task.update({ status: Task.STATUS.NOT_STARTED });
            expect((await checkDueTasks()).notificationsCreated).toBe(0);
            await expectRead(notification);
            await Notification.update(
                { created_at: new Date(Date.now() - 3 * 86400000) },
                { where: { id: notification.id } }
            );
            expect((await checkDueTasks()).notificationsCreated).toBe(1);
            expect(
                await Notification.count({
                    where: { user_id: user.id, read_at: null },
                })
            ).toBe(1);
        });

        it('backfills completed/archived tasks idempotently without changing unrelated or already read rows', async () => {
            const archived = await Task.create({
                name: 'Archived',
                user_id: user.id,
                status: 3,
            });
            const active = await Task.create({
                name: 'Active',
                user_id: user.id,
            });
            const otherUser = await createTestUser({
                email: 'other@example.com',
            });
            const toRead = await Promise.all([
                notify(task),
                notify(task, { type: 'task_overdue' }),
                notify(task, { type: 'task_assigned' }),
                notify(task, { type: 'task_completed' }),
                notify(task, {
                    data: { taskUid: task.uid, reason: 'defer_until_reached' },
                }),
                notify(archived),
            ]);
            const existing = await notify(task, {
                read_at: new Date('2026-01-01T12:00:00Z'),
            });
            const unaffected = await Promise.all([
                notify(active),
                notify(task, { user_id: otherUser.id }),
                notify(task, { type: 'project_due_soon' }),
                notify(task, { type: 'project_overdue' }),
                notify(task, { type: 'system' }),
                notify(task, { data: null }),
                notify(task, { data: { taskUid: 'missing-task' } }),
            ]);
            const malformed = await notify(task);
            await sequelize.query(
                'UPDATE notifications SET data = :data WHERE id = :id',
                {
                    replacements: { data: '{bad json', id: malformed.id },
                }
            );
            // Simulate pre-upgrade completed tasks without invoking the new hooks.
            await Task.update(
                { status: 2 },
                { where: { id: task.id }, hooks: false }
            );
            const queryInterface = sequelize.getQueryInterface();
            await migration.up(queryInterface);
            const first = await Notification.findAll({
                where: {
                    id: {
                        [Op.in]: [...toRead, existing].map((item) => item.id),
                    },
                },
                attributes: ['id', 'read_at', 'updated_at'],
                order: [['id', 'ASC']],
                raw: true,
            });
            for (const item of toRead) await expectRead(item);
            for (const item of unaffected) {
                await item.reload();
                expect(item.read_at).toBeNull();
            }
            const invalidRow = await Notification.findByPk(malformed.id, {
                attributes: ['read_at'],
            });
            expect(invalidRow.read_at).toBeNull();
            await existing.reload();
            expect(existing.read_at).toEqual(new Date('2026-01-01T12:00:00Z'));
            await migration.up(queryInterface);
            await migration.down(queryInterface);
            const second = await Notification.findAll({
                where: { id: { [Op.in]: first.map((item) => item.id) } },
                attributes: ['id', 'read_at', 'updated_at'],
                order: [['id', 'ASC']],
                raw: true,
            });
            expect(second).toEqual(first);
        });
    });

    describe('HTTP routes', () => {
        beforeEach(async () => {
            agent = request.agent(app);
            await agent
                .post('/api/login')
                .send({ email: user.email, password: 'password123' });
        });
        it('completes successfully with a malformed notification payload', async () => {
            const matching = await notify();
            const malformed = await notify();
            await sequelize.query(
                'UPDATE notifications SET data = :data WHERE id = :id',
                { replacements: { data: '{bad json', id: malformed.id } }
            );
            const response = await agent
                .patch(`/api/task/${task.uid}`)
                .send({ status: 'done' });
            expect(response.status).toBe(200);
            await task.reload();
            expect(task.status).toBe(Task.STATUS.DONE);
            await expectRead(matching);
        });

        it('returns success and logs a notification failure during completion', async () => {
            await notify();
            const failure = new Error('Notification storage unavailable');
            jest.spyOn(Notification, 'update').mockRejectedValue(failure);
            const response = await agent
                .patch(`/api/task/${task.uid}`)
                .send({ status: 'done' });
            expect(response.status).toBe(200);
            await task.reload();
            expect(task.status).toBe(Task.STATUS.DONE);
            expect(logError).toHaveBeenCalledWith(expect.any(String), failure);
        });

        it('handles completion of subtasks through the parent completion circle', async () => {
            const child = await Task.create({
                name: 'Child',
                user_id: user.id,
                parent_task_id: task.id,
            });
            const notifications = [await notify(), await notify(child)];
            const response = await agent
                .patch(`/api/task/${task.uid}`)
                .send({ status: Task.STATUS.DONE });
            expect(response.status).toBe(200);
            for (const item of notifications) await expectRead(item);
        });

        it('handles automatic parent completion when the last subtask completes', async () => {
            const child = await Task.create({
                name: 'Last child',
                user_id: user.id,
                parent_task_id: task.id,
            });
            const notification = await notify();
            const response = await agent
                .patch(`/api/task/${child.uid}`)
                .send({ status: 'done' });
            expect(response.status).toBe(200);
            await task.reload();
            expect(task.status).toBe(Task.STATUS.DONE);
            await expectRead(notification);
        });

        it.each([false, true])(
            'handles recurring occurrence completion (completion_based=%s) while the task stays open',
            async (completionBased) => {
                await task.update({
                    recurrence_type: 'daily',
                    recurrence_interval: 1,
                    completion_based: completionBased,
                    due_date: new Date(),
                });
                const notification = await notify();
                const response = await agent
                    .patch(`/api/task/${task.uid}`)
                    .send({ status: 'done' });
                expect(response.status).toBe(200);
                await task.reload();
                expect(task.status).toBe(Task.STATUS.NOT_STARTED);
                expect(
                    await RecurringCompletion.count({
                        where: { task_id: task.id },
                    })
                ).toBe(1);
                await expectRead(notification);
            }
        );

        it.each([2, 'done', 3, 'archived'])(
            'marks reminders read through PATCH status=%s',
            async (status) => {
                const notification = await notify();
                const response = await agent
                    .patch(`/api/task/${task.uid}`)
                    .send({ status });
                expect(response.status).toBe(200);
                await expectRead(notification);
                const list = await agent.get('/api/notifications');
                expect(list.body.notifications[0].read_at).toEqual(
                    expect.any(String)
                );
                const count = await agent.get(
                    '/api/notifications/unread-count'
                );
                expect(count.body.count).toBe(0);
            }
        );

        it('marks reminders read through the API v1 with a bearer token', async () => {
            const notification = await notify();
            const key = await agent
                .post('/api/profile/api-keys')
                .send({ name: 'Notification test' });
            expect(key.status).toBe(201);
            const response = await request(app)
                .patch(`/api/v1/task/${task.uid}`)
                .set('Authorization', `Bearer ${key.body.token}`)
                .send({ status: 'done' });
            expect(response.status).toBe(200);
            await expectRead(notification);
        });

        it('handles bulk subtask updates from a task edit', async () => {
            const child = await Task.create({
                name: 'Child',
                user_id: user.id,
                parent_task_id: task.id,
            });
            const notification = await notify(child);
            const response = await agent.patch(`/api/task/${task.uid}`).send({
                subtasks: [
                    { id: child.id, status: 'done', _statusChanged: true },
                ],
            });
            expect(response.status).toBe(200);
            await expectRead(notification);
        });

        it('does not reopen old notifications when reopening a task', async () => {
            const notification = await notify();
            await agent.patch(`/api/task/${task.uid}`).send({ status: 'done' });
            await notification.reload();
            const readAt = notification.read_at;
            const response = await agent
                .patch(`/api/task/${task.uid}`)
                .send({ status: 'not_started' });
            expect(response.status).toBe(200);
            await expectRead(notification);
            expect(notification.read_at).toEqual(readAt);
        });

        it('marks notifications read when deleting through the API', async () => {
            const notification = await notify();
            const response = await agent.delete(`/api/task/${task.uid}`);
            expect(response.status).toBe(200);
            expect(await Task.findByPk(task.id)).toBeNull();
            await expectRead(notification);
        });
    });
});
