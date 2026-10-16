'use strict';

module.exports = {
    async up(queryInterface) {
        // Data-only repair; preserve read timestamps and non-task notifications.
        // CASE also tolerates legacy rows containing invalid JSON.
        await queryInterface.sequelize.query(
            `UPDATE notifications
             SET read_at = :readAt, updated_at = :readAt
             WHERE read_at IS NULL
               AND type IN ('task_assigned', 'task_completed', 'task_due_soon', 'task_overdue')
               AND EXISTS (
                   SELECT 1 FROM tasks
                   WHERE tasks.status IN (2, 3)
                     AND tasks.user_id = notifications.user_id
                     AND tasks.uid = CASE WHEN json_valid(notifications.data)
                         THEN json_extract(notifications.data, '$.taskUid') END
               )`,
            { replacements: { readAt: new Date() } }
        );
    },

    async down() {
        // Read state cannot be restored safely; never reopen old notifications.
    },
};
