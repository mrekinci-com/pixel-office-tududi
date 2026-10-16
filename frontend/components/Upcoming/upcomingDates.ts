import { Task } from '../../entities/Task';
import { Project } from '../../entities/Project';

const DAY = 86400000;

// UTC is used only as a civil-date arithmetic container, never to convert API dates.
const civilDate = (day: string): Date => new Date(`${day}T12:00:00Z`);
const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

export const dueDay = (task: Task): string | null => {
    const day = task.due_date?.slice(0, 10);
    return day &&
        /^\d{4}-\d{2}-\d{2}$/.test(day) &&
        !Number.isNaN(civilDate(day).getTime()) &&
        dayKey(civilDate(day)) === day
        ? day
        : null;
};

export const todayInTimezone = (now: Date, timeZone?: string): string => {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(now);
        const part = (type: string) =>
            parts.find((item) => item.type === type)!.value;
        return `${part('year')}-${part('month')}-${part('day')}`;
    } catch {
        return todayInTimezone(now);
    }
};

export const addDays = (day: string, count: number): string =>
    dayKey(new Date(civilDate(day).getTime() + count * DAY));

export const daysBetween = (from: string, to: string): number =>
    Math.round((civilDate(to).getTime() - civilDate(from).getTime()) / DAY);

export const mondayOfWeek = (day: string): string =>
    addDays(day, -((civilDate(day).getUTCDay() + 6) % 7));

export const monthGrid = (month: string): string[] => {
    const firstMonday = mondayOfWeek(`${month.slice(0, 7)}-01`);
    return Array.from({ length: 42 }, (_, index) =>
        addDays(firstMonday, index)
    );
};

export const shiftMonth = (month: string, count: number): string => {
    const date = civilDate(`${month.slice(0, 7)}-01`);
    date.setUTCMonth(date.getUTCMonth() + count);
    return dayKey(date);
};

export const formatCivilDate = (
    day: string,
    language: string,
    options: Intl.DateTimeFormatOptions
): string =>
    new Intl.DateTimeFormat(language || 'en', {
        ...options,
        timeZone: 'UTC',
    }).format(civilDate(day));

export const formatAgendaDate = (day: string, language: string): string =>
    `${formatCivilDate(day, language, { weekday: 'long' })}, ${formatCivilDate(day, language, { day: 'numeric', month: 'long' })}`;

export const isCompleted = (task: Task): boolean =>
    ['done', 'archived', 2, 3].includes(task.status);

export const agendaGroups = [
    'overdue',
    'today',
    'tomorrow',
    'thisWeek',
    'nextWeek',
    'thisMonth',
    'later',
] as const;
export type AgendaGroup = (typeof agendaGroups)[number];

export const agendaGroup = (day: string, today: string): AgendaGroup => {
    if (day < today) return 'overdue';
    if (day === today) return 'today';
    if (day === addDays(today, 1)) return 'tomorrow';
    const monday = mondayOfWeek(today);
    if (day < addDays(monday, 7)) return 'thisWeek';
    if (day < addDays(monday, 14)) return 'nextWeek';
    if (day.slice(0, 7) === today.slice(0, 7)) return 'thisMonth';
    return 'later';
};

export const relativeDue = (
    day: string,
    today: string
): { key: string; count: number } => {
    const count = daysBetween(today, day);
    return {
        key:
            count === 0
                ? 'today'
                : count === 1
                  ? 'tomorrow'
                  : count < 0
                    ? 'daysOverdue'
                    : 'daysLeft',
        count: Math.abs(count),
    };
};

export const projectKey = (project?: Project, id?: number): string =>
    String(project?.id ?? id ?? project?.uid ?? 'none');

// Hues ordered so that neighbouring project ids get clearly different colours.
const colors = [
    '#16a34a', // green
    '#ea580c', // orange
    '#7c3aed', // violet
    '#0284c7', // sky
    '#db2777', // pink
    '#ca8a04', // amber
    '#0d9488', // teal
    '#dc2626', // red
    '#4f46e5', // indigo
    '#65a30d', // lime
];

export const projectColor = (project?: Project, id?: number): string => {
    const explicit = (project as Project & { color?: string })?.color;
    if (explicit && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(explicit))
        return explicit;
    // Sequential numeric ids map straight onto the palette (no collisions for
    // the first ten projects); other keys fall back to a stable hash.
    const numeric = Number(project?.id ?? id);
    if (Number.isInteger(numeric) && numeric > 0) {
        return colors[(numeric - 1) % colors.length];
    }
    const hash = Array.from(projectKey(project, id)).reduce(
        (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
        0
    );
    return colors[hash % colors.length];
};

export const VIEW_KEY = 'upcoming_view';
export const PROJECTS_KEY = 'upcoming_hidden_projects';
export type UpcomingView = 'calendar' | 'agenda';

export const readView = (): UpcomingView => {
    try {
        const saved = localStorage.getItem(VIEW_KEY);
        if (saved === 'calendar' || saved === 'agenda') return saved;
    } catch {
        /* Storage can be unavailable in private browsing. */
    }
    return window.innerWidth >= 768 ? 'calendar' : 'agenda';
};

export const readHiddenProjects = (): string[] => {
    try {
        const saved = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]');
        if (
            Array.isArray(saved) &&
            saved.every((key) => typeof key === 'string')
        )
            return saved;
    } catch {
        /* Invalid or unavailable storage falls back to showing all projects. */
    }
    return [];
};

export const savePreference = (key: string, value: string): void => {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* In-memory selection still works. */
    }
};
