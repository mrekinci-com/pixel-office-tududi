const moment = require('moment-timezone');
require('moment/locale/tr');
// Loading a locale file switches moment's global locale; keep English as the
// global default and apply Turkish only per formatted date.
moment.locale('en');
const { getSafeTimezone } = require('../../../utils/timezone-utils');
const { sortTasksByOrder } = require('./sorting');

function categorizeTasksByDate(tasks, cutoffDate, safeTimezone) {
    const tasksByDate = new Map();

    tasks.forEach((task) => {
        if (!task.due_date) {
            if (!tasksByDate.has('no-date')) {
                tasksByDate.set('no-date', []);
            }
            tasksByDate.get('no-date').push(task);
            return;
        }

        const taskDueDate = moment.tz(task.due_date, safeTimezone);

        if (taskDueDate.isAfter(cutoffDate)) {
            return;
        }

        const dateKey = taskDueDate.format('YYYY-MM-DD');

        if (!tasksByDate.has(dateKey)) {
            tasksByDate.set(dateKey, []);
        }
        tasksByDate.get(dateKey).push(task);
    });

    return tasksByDate;
}

// day titles follow the user's language (upstream: English only).
const GROUP_LABELS = {
    tr: { today: 'Bugün', tomorrow: 'Yarın', noDate: 'Tarihsiz' },
};

function generateGroupName(dateKey, now, safeTimezone, language) {
    const lang = GROUP_LABELS[language] ? language : 'en';
    const dateMoment = moment.tz(dateKey, safeTimezone).locale(lang);
    const isToday = dateMoment.isSame(now, 'day');
    const isTomorrow = dateMoment.isSame(now.clone().add(1, 'day'), 'day');
    const labels = GROUP_LABELS[lang];

    if (isToday) {
        return labels ? labels.today : 'Today';
    } else if (isTomorrow) {
        return labels ? labels.tomorrow : 'Tomorrow';
    } else if (labels) {
        return dateMoment.format('dddd, D MMMM');
    } else {
        return `${dateMoment.format('dddd')}, ${dateMoment.format('MMMM D')}`;
    }
}

async function groupTasksByDay(
    tasks,
    userTimezone,
    maxDays = 14,
    orderBy = 'created_at:desc',
    language = 'en'
) {
    const safeTimezone = getSafeTimezone(userTimezone);
    const now = moment.tz(safeTimezone);
    const cutoffDate = now.clone().add(maxDays, 'days').endOf('day');

    const tasksByDate = categorizeTasksByDate(tasks, cutoffDate, safeTimezone);

    const sortedDates = Array.from(tasksByDate.keys())
        .filter((key) => key !== 'no-date' && key !== 'later')
        .sort();

    const groupedTasks = {};

    sortedDates.forEach((dateKey) => {
        const groupName = generateGroupName(
            dateKey,
            now,
            safeTimezone,
            language
        );
        const tasksForDate = tasksByDate.get(dateKey);
        sortTasksByOrder(tasksForDate, orderBy, safeTimezone);
        groupedTasks[groupName] = tasksForDate;
    });

    if (tasksByDate.has('no-date')) {
        const noDateTasks = tasksByDate.get('no-date');
        sortTasksByOrder(noDateTasks, orderBy, safeTimezone);
        groupedTasks[GROUP_LABELS[language]?.noDate || 'No Due Date'] =
            noDateTasks;
    }

    return groupedTasks;
}

module.exports = {
    categorizeTasksByDate,
    generateGroupName,
    groupTasksByDay,
};
