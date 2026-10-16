const { Op, literal, where, Transaction } = require('sequelize');
const logService = require('./logService');

// Includes the due/deferred reminders and other notifications tied to a task.
const TASK_NOTIFICATION_TYPES = [
    'task_assigned',
    'task_completed',
    'task_due_soon',
    'task_overdue',
];

// Reminders that describe a date; they go stale when that date moves later.
const DUE_REMINDER_TYPES = ['task_due_soon', 'task_overdue'];

async function markTaskNotificationsRead(
    task,
    options = {},
    types = TASK_NOTIFICATION_TYPES
) {
    try {
        const { Notification } = task.sequelize.models;
        return await Notification.update(
            { read_at: new Date() },
            {
                where: {
                    user_id: task.user_id,
                    read_at: null,
                    type: { [Op.in]: types },
                    [Op.and]: where(
                        literal(
                            `CASE WHEN json_valid(data) THEN json_extract(data, '$.taskUid') END`
                        ),
                        task.uid
                    ),
                },
                transaction: options.transaction,
            }
        );
    } catch (error) {
        // Notification maintenance must never fail the task operation.
        logService.logError(
            `Error marking notifications read for task ${task.id}:`,
            error
        );
    }
}

async function createTaskNotificationIfActive(task, attributes) {
    const { Task, Notification, RecurringCompletion } = task.sequelize.models;
    // Reserve SQLite's writer lock before reading, so completion/deletion cannot
    // commit between the current-state check and the notification insert.
    return task.sequelize.transaction(
        { type: Transaction.TYPES.IMMEDIATE },
        async (transaction) => {
            const currentTask = await Task.findOne({
                where: {
                    id: task.id,
                    uid: task.uid,
                    user_id: task.user_id,
                    // Reminder content belongs to the dates/occurrence read by
                    // the scheduler. A changed task must wait for the next run.
                    due_date: task.due_date,
                    defer_until: task.defer_until,
                    recurrence_type: task.recurrence_type,
                    recurring_parent_id: task.recurring_parent_id,
                    status: {
                        [Op.notIn]: [Task.STATUS.DONE, Task.STATUS.ARCHIVED],
                    },
                },
                transaction,
            });
            if (!currentTask) return null;
            // Occurrences are identified by (task_id, original_due_date).
            // Completion may be recorded before the task's date advances.
            if (
                currentTask.recurrence_type !== 'none' &&
                currentTask.due_date !== null
            ) {
                const completion = await RecurringCompletion.findOne({
                    where: {
                        task_id: currentTask.id,
                        original_due_date: currentTask.due_date,
                        skipped: false,
                    },
                    transaction,
                });
                if (completion) return null;
            }
            return Notification.createNotification(attributes, { transaction });
        }
    );
}

function registerTaskNotificationHooks(Task) {
    const isTerminal = (status) =>
        [Task.STATUS.DONE, Task.STATUS.ARCHIVED].includes(Number(status));

    const time = (value) => {
        if (value === null || value === undefined) return null;
        const ms = new Date(value).getTime();
        return Number.isNaN(ms) ? null : ms;
    };
    // Old due date of an update in flight; read before the save overwrites it.
    const previousDue = new WeakMap();

    Task.addHook('beforeUpdate', (task) => {
        if (task.changed('due_date')) {
            previousDue.set(task, task.previous('due_date'));
        }
    });
    Task.addHook('afterUpdate', async (task, options) => {
        const hadDueChange = previousDue.has(task);
        const before = time(previousDue.get(task));
        previousDue.delete(task);
        if (isTerminal(task.status)) {
            await markTaskNotificationsRead(task, options);
            return;
        }
        // A reminder for a date the task no longer has is stale once the date
        // is moved later or removed. An earlier date keeps its reminders.
        const after = time(task.due_date);
        if (
            hadDueChange &&
            before !== null &&
            (after === null || after > before)
        ) {
            await markTaskNotificationsRead(task, options, DUE_REMINDER_TYPES);
        }
    });
    Task.addHook('afterDestroy', (task, options) =>
        markTaskNotificationsRead(task, options)
    );

    // Sequelize bulk operations skip instance hooks unless explicitly enabled.
    Task.addHook('beforeBulkUpdate', (options) => {
        if (
            isTerminal(options.attributes.status) ||
            Object.prototype.hasOwnProperty.call(options.attributes, 'due_date')
        ) {
            options.individualHooks = true;
        }
    });
    Task.addHook('beforeBulkDestroy', (options) => {
        options.individualHooks = true;
    });
}

function registerRecurringCompletionNotificationHooks(RecurringCompletion) {
    const markOccurrenceRead = async (completion, options) => {
        if (completion.skipped) return;
        try {
            const task =
                await RecurringCompletion.sequelize.models.Task.findByPk(
                    completion.task_id,
                    { transaction: options.transaction }
                );
            if (task) await markTaskNotificationsRead(task, options);
        } catch (error) {
            logService.logError(
                `Error reading notification task for completion ${completion.id}:`,
                error
            );
        }
    };

    // Recurring tasks can advance to the next due date without becoming DONE.
    RecurringCompletion.addHook('afterCreate', markOccurrenceRead);
    RecurringCompletion.addHook(
        'afterBulkCreate',
        async (completions, options) => {
            for (const completion of completions) {
                await markOccurrenceRead(completion, options);
            }
        }
    );
}

module.exports = {
    createTaskNotificationIfActive,
    registerTaskNotificationHooks,
    registerRecurringCompletionNotificationHooks,
};
