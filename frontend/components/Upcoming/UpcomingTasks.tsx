import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    ChevronLeftIcon,
    ChevronRightIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import { Task } from '../../entities/Task';
import { Project } from '../../entities/Project';
import { getApiPath } from '../../config/paths';
import { createTask, updateTask } from '../../utils/tasksService';
import { createProject, fetchProjects } from '../../utils/projectsService';
import { getCurrentUser } from '../../utils/userUtils';
import TaskModal from '../Task/TaskModal';
import { useToast } from '../Shared/ToastContext';
import {
    addDays,
    agendaGroup,
    agendaGroups,
    dueDay,
    formatCivilDate,
    formatAgendaDate,
    isCompleted,
    mondayOfWeek,
    monthGrid,
    projectColor,
    projectKey,
    readHiddenProjects,
    readView,
    relativeDue,
    savePreference,
    shiftMonth,
    todayInTimezone,
    UpcomingView,
    VIEW_KEY,
    PROJECTS_KEY,
} from './upcomingDates';
import { isBistClosed } from '../../data/bistClosures';
import './upcoming.css';

const DRAG_TYPE = 'application/x-tududi-task';
const CLOSURES_KEY = 'upcoming_show_bist_closures';
const MAX_CHIPS = 3;

const UpcomingTasks: React.FC = () => {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const { showErrorToast } = useToast();
    const [view, setView] = useState<UpcomingView>(readView);
    const [hiddenProjects, setHiddenProjects] =
        useState<string[]>(readHiddenProjects);
    const [showCompleted, setShowCompleted] = useState(false);
    // Exchange holidays are an optional layer; other projects can turn it off.
    const [showClosures, setShowClosures] = useState(() => {
        try {
            return localStorage.getItem(CLOSURES_KEY) !== 'off';
        } catch {
            return true;
        }
    });
    const toggleClosures = (value: boolean) => {
        setShowClosures(value);
        try {
            localStorage.setItem(CLOSURES_KEY, value ? 'on' : 'off');
        } catch {
            // The choice still applies for this visit.
        }
    };
    const [today, setToday] = useState(() =>
        todayInTimezone(new Date(), getCurrentUser()?.timezone)
    );
    const [month, setMonth] = useState(`${today.slice(0, 7)}-01`);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [newTask, setNewTask] = useState<Task | null>(null);
    const [dayPanel, setDayPanel] = useState<{
        day: string;
        top: number;
        left: number;
    } | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const panelTrigger = useRef<HTMLButtonElement | null>(null);
    const overdueRef = useRef<HTMLElement>(null);
    const [jumpToOverdue, setJumpToOverdue] = useState(false);
    const pendingMoves = useRef(new Set<string>());
    const [movingTasks, setMovingTasks] = useState<string[]>([]);
    const requestVersion = useRef(0);
    // A refresh requested while a drag-move is saving runs after it settles,
    // so a stale read can never overwrite the moved date.
    const refreshDeferred = useRef(false);

    const refreshTasks = useCallback(async () => {
        if (pendingMoves.current.size) {
            refreshDeferred.current = true;
            return;
        }
        const version = ++requestVersion.current;
        try {
            // Recurring tasks appear only at their own due date; no occurrence expansion.
            const response = await fetch(
                getApiPath('tasks?type=all&client_side_filtering=true'),
                {
                    credentials: 'include',
                }
            );
            if (!response.ok) throw new Error('tasks');
            const data = await response.json();
            if (version === requestVersion.current) {
                setTasks(data.tasks || []);
                setLoadError(false);
            }
        } catch {
            if (version === requestVersion.current) setLoadError(true);
        } finally {
            if (version === requestVersion.current) setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refreshTasks();
        let active = true;
        void fetchProjects()
            .then((data) => {
                if (active) setProjects(data);
            })
            .catch(() => {
                if (active) setActionError(t('upcoming.projectLoadError'));
            });
        const onChange = () => {
            // A pending optimistic move must settle before replacing the local snapshot.
            void refreshTasks();
            setToday(todayInTimezone(new Date(), getCurrentUser()?.timezone));
        };
        window.addEventListener('focus', onChange);
        window.addEventListener('taskCreated', onChange);
        window.addEventListener('taskUpdated', onChange);
        window.addEventListener('taskDeleted', onChange);
        const timer = window.setInterval(() => {
            setToday(todayInTimezone(new Date(), getCurrentUser()?.timezone));
        }, 60000);
        return () => {
            active = false;
            ++requestVersion.current;
            window.clearInterval(timer);
            window.removeEventListener('focus', onChange);
            window.removeEventListener('taskCreated', onChange);
            window.removeEventListener('taskUpdated', onChange);
            window.removeEventListener('taskDeleted', onChange);
        };
    }, [refreshTasks, t]);

    useEffect(() => {
        savePreference(VIEW_KEY, view);
    }, [view]);
    useEffect(() => {
        savePreference(PROJECTS_KEY, JSON.stringify(hiddenProjects));
    }, [hiddenProjects]);
    useEffect(() => {
        if (jumpToOverdue && view === 'agenda') {
            overdueRef.current?.scrollIntoView?.({
                behavior: 'smooth',
                block: 'start',
            });
            overdueRef.current?.focus();
            setJumpToOverdue(false);
        }
    }, [jumpToOverdue, view]);

    const closePanel = useCallback(() => {
        setDayPanel(null);
        panelTrigger.current?.focus();
        panelTrigger.current = null;
    }, []);
    useEffect(() => {
        if (!dayPanel) return;
        panelRef.current?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closePanel();
        };
        const onOutside = (event: MouseEvent) => {
            if (
                !panelRef.current?.contains(event.target as Node) &&
                !panelTrigger.current?.contains(event.target as Node)
            )
                closePanel();
        };
        const onScroll = (event: Event) => {
            if (!panelRef.current?.contains(event.target as Node)) closePanel();
        };
        document.addEventListener('keydown', onKey);
        document.addEventListener('mousedown', onOutside);
        window.addEventListener('resize', closePanel);
        window.addEventListener('scroll', onScroll, true);
        return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onOutside);
            window.removeEventListener('resize', closePanel);
            window.removeEventListener('scroll', onScroll, true);
        };
    }, [dayPanel, closePanel]);

    const datedTasks = useMemo(
        () => tasks.filter((task) => dueDay(task)),
        [tasks]
    );
    const resolveProject = (task: Task): Project | undefined =>
        projects.find(
            (project) =>
                task.project_id != null && project.id === task.project_id
        ) ||
        projects.find(
            (project) =>
                projectKey(project) ===
                projectKey(task.Project, task.project_id)
        ) ||
        task.Project;
    const taskProjectKey = (task: Task) =>
        projectKey(resolveProject(task), task.project_id);
    const taskColor = (task: Task) =>
        projectColor(resolveProject(task), task.project_id);
    const projectOptions = useMemo(() => {
        const options = new Map<string, Project>();
        projects.forEach((project) =>
            options.set(projectKey(project), project)
        );
        datedTasks.forEach((task) => {
            const key = projectKey(task.Project, task.project_id);
            if (!options.has(key))
                options.set(
                    key,
                    task.Project || {
                        id: task.project_id,
                        name:
                            key === 'none'
                                ? t('upcoming.noProject')
                                : t('upcoming.projectNumber', { id: key }),
                    }
                );
        });
        return Array.from(options.entries());
    }, [projects, datedTasks, t]);
    const visibleTasks = datedTasks
        .filter(
            (task) =>
                (showCompleted || !isCompleted(task)) &&
                !hiddenProjects.includes(taskProjectKey(task))
        )
        .sort(
            (a, b) =>
                dueDay(a)!.localeCompare(dueDay(b)!) ||
                a.name.localeCompare(b.name)
        );
    const tasksByDay = new Map<string, Task[]>();
    visibleTasks.forEach((task) => {
        const day = dueDay(task)!;
        tasksByDay.set(day, [...(tasksByDay.get(day) || []), task]);
    });
    // Summary counts are actionable, unfinished tasks within the current project filter.
    const activeTasks = visibleTasks.filter((task) => !isCompleted(task));
    const weekStart = mondayOfWeek(today);
    const overdueCount = activeTasks.filter(
        (task) => dueDay(task)! < today
    ).length;
    const weekCount = activeTasks.filter(
        (task) =>
            dueDay(task)! >= weekStart && dueDay(task)! < addDays(weekStart, 7)
    ).length;
    const monthCount = activeTasks.filter(
        (task) => dueDay(task)! >= today && dueDay(task)! < addDays(today, 30)
    ).length;
    const days = monthGrid(month);
    const dayLabel = (day: string) => formatAgendaDate(day, i18n.language);
    const changeMonth = (count: number) => {
        closePanel();
        setMonth((current) => shiftMonth(current, count));
    };
    const openNewTask = (day: string) => {
        closePanel();
        setNewTask({
            name: '',
            status: 'not_started',
            completed_at: null,
            due_date: day,
        });
    };

    const moveTask = async (uid: string, day: string) => {
        const original = tasks.find((task) => task.uid === uid);
        if (
            !original ||
            dueDay(original) === day ||
            pendingMoves.current.has(uid)
        )
            return;
        pendingMoves.current.add(uid);
        setMovingTasks((current) => [...current, uid]);
        // Invalidate any older in-flight read so it cannot overwrite the optimistic move.
        ++requestVersion.current;
        setActionError(null);
        setTasks((current) =>
            current.map((task) =>
                task.uid === uid ? { ...task, due_date: day } : task
            )
        );
        try {
            await updateTask(uid, { due_date: day });
        } catch {
            setTasks((current) =>
                current.map((task) =>
                    task.uid === uid
                        ? { ...task, due_date: original.due_date }
                        : task
                )
            );
            setActionError(t('upcoming.moveError'));
        } finally {
            pendingMoves.current.delete(uid);
            setMovingTasks((current) => current.filter((item) => item !== uid));
            if (!pendingMoves.current.size && refreshDeferred.current) {
                refreshDeferred.current = false;
                void refreshTasks();
            }
        }
    };

    const taskChip = (task: Task) => {
        const completed = isCompleted(task);
        const overdue = dueDay(task)! < today && !completed;
        return (
            <button
                key={task.uid || task.id}
                type="button"
                className={`upcoming-task-chip ${completed ? 'is-completed' : ''} ${overdue ? 'is-overdue' : ''}`}
                style={{ borderLeftColor: taskColor(task) }}
                title={task.name}
                aria-label={task.name}
                disabled={movingTasks.includes(task.uid)}
                draggable={!!task.uid && !movingTasks.includes(task.uid)}
                onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_TYPE, task.uid!);
                    event.dataTransfer.effectAllowed = 'move';
                }}
                onClick={() => task.uid && navigate(`/task/${task.uid}`)}
            >
                {task.name}
            </button>
        );
    };

    return (
        <div className="upcoming-page text-gray-900 dark:text-gray-100">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 className="text-2xl font-light">{t('upcoming.title')}</h2>
                <div
                    className="upcoming-segments"
                    role="group"
                    aria-label={t('upcoming.view')}
                >
                    {(['calendar', 'agenda'] as UpcomingView[]).map((item) => (
                        <button
                            key={item}
                            type="button"
                            aria-pressed={view === item}
                            onClick={() => {
                                setView(item);
                                closePanel();
                            }}
                        >
                            {t(`upcoming.${item}`)}
                        </button>
                    ))}
                </div>
            </div>
            <div
                className="upcoming-summary"
                aria-label={t('upcoming.summary')}
            >
                <button
                    type="button"
                    className={
                        overdueCount > 0 ? 'text-red-600 dark:text-red-400' : ''
                    }
                    onClick={() => {
                        setView('agenda');
                        setJumpToOverdue(true);
                    }}
                    aria-label={t('upcoming.overdueCount', {
                        count: overdueCount,
                    })}
                >
                    {t('upcoming.overdueCount', { count: overdueCount })}
                </button>
                <span aria-hidden="true">·</span>
                <span>{t('upcoming.weekCount', { count: weekCount })}</span>
                <span aria-hidden="true">·</span>
                <span>
                    {t('upcoming.thirtyDayCount', { count: monthCount })}
                </span>
            </div>
            <div
                className="flex flex-wrap gap-2 mt-3"
                role="group"
                aria-label={t('upcoming.projectFilter')}
            >
                {projectOptions.map(([key, project]) => (
                    <button
                        key={key}
                        type="button"
                        className="upcoming-project-filter"
                        aria-pressed={!hiddenProjects.includes(key)}
                        onClick={() =>
                            setHiddenProjects((current) =>
                                current.includes(key)
                                    ? current.filter((item) => item !== key)
                                    : [...current, key]
                            )
                        }
                    >
                        <span
                            className="upcoming-project-dot"
                            style={{ backgroundColor: projectColor(project) }}
                            aria-hidden="true"
                        />
                        <span className="truncate">{project.name}</span>
                    </button>
                ))}
            </div>
            <label className="inline-flex items-center gap-2 mt-4 mb-4 text-sm cursor-pointer">
                <input
                    type="checkbox"
                    role="switch"
                    checked={showCompleted}
                    onChange={(event) => setShowCompleted(event.target.checked)}
                />
                {t('upcoming.showCompleted')}
            </label>
            <label className="inline-flex items-center gap-2 mt-4 mb-4 ml-6 text-sm cursor-pointer">
                <input
                    type="checkbox"
                    role="switch"
                    checked={showClosures}
                    onChange={(event) => toggleClosures(event.target.checked)}
                />
                {t('upcoming.showClosures')}
            </label>
            {actionError && (
                <div className="upcoming-error" role="alert">
                    <span>{actionError}</span>
                    <button
                        type="button"
                        aria-label={t('upcoming.dismiss')}
                        onClick={() => setActionError(null)}
                    >
                        <XMarkIcon className="w-4 h-4" />
                    </button>
                </div>
            )}
            {loadError && (
                <div className="upcoming-error" role="alert">
                    <span>{t('upcoming.loadError')}</span>
                    <button type="button" onClick={() => void refreshTasks()}>
                        {t('upcoming.retry')}
                    </button>
                </div>
            )}
            {loading ? (
                <p role="status">{t('upcoming.loading')}</p>
            ) : view === 'calendar' ? (
                <>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <h3 className="text-lg font-semibold">
                            {formatCivilDate(month, i18n.language, {
                                month: 'long',
                                year: 'numeric',
                            })}
                        </h3>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                className="upcoming-nav"
                                aria-label={t('upcoming.previousMonth')}
                                onClick={() => changeMonth(-1)}
                            >
                                <ChevronLeftIcon className="w-5 h-5" />
                            </button>
                            <button
                                type="button"
                                className="upcoming-nav"
                                onClick={() => {
                                    closePanel();
                                    setMonth(`${today.slice(0, 7)}-01`);
                                }}
                            >
                                {t('upcoming.today')}
                            </button>
                            <button
                                type="button"
                                className="upcoming-nav"
                                aria-label={t('upcoming.nextMonth')}
                                onClick={() => changeMonth(1)}
                            >
                                <ChevronRightIcon className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                    <div
                        className="upcoming-calendar"
                        aria-label={t('upcoming.calendar')}
                    >
                        {days.slice(0, 7).map((day) => (
                            <div
                                key={`heading-${day}`}
                                className="upcoming-weekday"
                                title={formatCivilDate(day, i18n.language, {
                                    weekday: 'long',
                                })}
                            >
                                <span className="hidden md:inline">
                                    {formatCivilDate(day, i18n.language, {
                                        weekday: 'long',
                                    })}
                                </span>
                                <span className="md:hidden">
                                    {formatCivilDate(day, i18n.language, {
                                        weekday: 'short',
                                    })}
                                </span>
                            </div>
                        ))}
                        {days.map((day, index) => {
                            const dayTasks = tasksByDay.get(day) || [];
                            return (
                                <div
                                    key={day}
                                    data-date={day}
                                    className={`upcoming-day ${index % 7 >= 5 ? 'is-weekend' : ''} ${day.slice(0, 7) !== month.slice(0, 7) ? 'is-other-month' : ''} ${day === today ? 'is-today' : ''}`}
                                    onDragOver={(event) => {
                                        if (
                                            Array.from(
                                                event.dataTransfer.types
                                            ).includes(DRAG_TYPE)
                                        ) {
                                            event.preventDefault();
                                            event.dataTransfer.dropEffect =
                                                'move';
                                        }
                                    }}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        const uid =
                                            event.dataTransfer.getData(
                                                DRAG_TYPE
                                            );
                                        if (uid) void moveTask(uid, day);
                                    }}
                                >
                                    <button
                                        type="button"
                                        className="upcoming-add-day"
                                        aria-label={t('upcoming.addOnDate', {
                                            date: dayLabel(day),
                                        })}
                                        onClick={() => openNewTask(day)}
                                    />
                                    <div className="upcoming-day-heading">
                                        <time
                                            dateTime={day}
                                            aria-current={
                                                day === today
                                                    ? 'date'
                                                    : undefined
                                            }
                                        >
                                            {Number(day.slice(8, 10))}
                                        </time>
                                        {showClosures && isBistClosed(day) && (
                                            <span
                                                className="upcoming-closure"
                                                title={t(
                                                    'upcoming.closureTitle'
                                                )}
                                            >
                                                {t('upcoming.closed')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="upcoming-day-tasks">
                                        {dayTasks
                                            .slice(0, MAX_CHIPS)
                                            .map(taskChip)}
                                        {dayTasks.length > MAX_CHIPS && (
                                            <button
                                                type="button"
                                                className="upcoming-more"
                                                aria-expanded={
                                                    dayPanel?.day === day
                                                }
                                                aria-controls={
                                                    dayPanel?.day === day
                                                        ? 'upcoming-day-panel'
                                                        : undefined
                                                }
                                                onClick={(event) => {
                                                    if (dayPanel?.day === day) {
                                                        closePanel();
                                                        return;
                                                    }
                                                    panelTrigger.current =
                                                        event.currentTarget;
                                                    const rect =
                                                        event.currentTarget.getBoundingClientRect();
                                                    setDayPanel({
                                                        day,
                                                        left: Math.max(
                                                            12,
                                                            Math.min(
                                                                rect.left,
                                                                window.innerWidth -
                                                                    332
                                                            )
                                                        ),
                                                        top: Math.max(
                                                            12,
                                                            Math.min(
                                                                rect.bottom + 6,
                                                                window.innerHeight -
                                                                    300
                                                            )
                                                        ),
                                                    });
                                                }}
                                            >
                                                {t('upcoming.more', {
                                                    count:
                                                        dayTasks.length -
                                                        MAX_CHIPS,
                                                })}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            ) : (
                <div className="upcoming-agenda">
                    {!visibleTasks.length && (
                        <p className="py-8 text-gray-500 dark:text-gray-400">
                            {t('upcoming.empty')}
                        </p>
                    )}
                    {agendaGroups.map((group) => {
                        const groupTasks = visibleTasks.filter(
                            (task) =>
                                agendaGroup(dueDay(task)!, today) === group
                        );
                        if (!groupTasks.length) return null;
                        return (
                            <section
                                key={group}
                                ref={
                                    group === 'overdue' ? overdueRef : undefined
                                }
                                tabIndex={-1}
                                aria-labelledby={`upcoming-${group}`}
                                className="upcoming-agenda-group"
                            >
                                <h3
                                    id={`upcoming-${group}`}
                                    className={`font-semibold mb-2 ${group === 'overdue' ? 'text-red-600 dark:text-red-400' : ''}`}
                                >
                                    {t(`upcoming.${group}`)}
                                </h3>
                                <ul>
                                    {groupTasks.map((task) => {
                                        const day = dueDay(task)!;
                                        const relative = relativeDue(
                                            day,
                                            today
                                        );
                                        const completed = isCompleted(task);
                                        const status = completed
                                            ? 'done'
                                            : task.status === 'in_progress' ||
                                                task.status === 1
                                              ? 'inProgress'
                                              : task.status === 'waiting' ||
                                                  task.status === 4
                                                ? 'waiting'
                                                : 'notStarted';
                                        return (
                                            <li key={task.uid || task.id}>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        task.uid &&
                                                        navigate(
                                                            `/task/${task.uid}`
                                                        )
                                                    }
                                                    className={`upcoming-agenda-row ${completed ? 'is-completed' : ''}`}
                                                    title={task.name}
                                                >
                                                    <span
                                                        className="upcoming-status"
                                                        aria-label={t(
                                                            `upcoming.${status}`
                                                        )}
                                                    >
                                                        {completed
                                                            ? '✓'
                                                            : status ===
                                                                'inProgress'
                                                              ? '◐'
                                                              : status ===
                                                                  'waiting'
                                                                ? '◷'
                                                                : '○'}
                                                    </span>
                                                    <span className="upcoming-agenda-name">
                                                        {task.name}
                                                    </span>
                                                    <span className="upcoming-agenda-project">
                                                        <span
                                                            className="upcoming-project-dot"
                                                            style={{
                                                                backgroundColor:
                                                                    taskColor(
                                                                        task
                                                                    ),
                                                            }}
                                                            aria-hidden="true"
                                                        />
                                                        {resolveProject(task)
                                                            ?.name ||
                                                            t(
                                                                'upcoming.noProject'
                                                            )}
                                                    </span>
                                                    <time dateTime={day}>
                                                        {dayLabel(day)}
                                                    </time>
                                                    <span
                                                        className={
                                                            day < today &&
                                                            !completed
                                                                ? 'text-red-600 dark:text-red-400'
                                                                : ''
                                                        }
                                                    >
                                                        {t(
                                                            `upcoming.${relative.key}`,
                                                            {
                                                                count: relative.count,
                                                            }
                                                        )}
                                                    </span>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </section>
                        );
                    })}
                </div>
            )}
            {dayPanel && (
                <div
                    id="upcoming-day-panel"
                    ref={panelRef}
                    role="dialog"
                    tabIndex={-1}
                    aria-label={dayLabel(dayPanel.day)}
                    className="upcoming-day-panel"
                    style={{ top: dayPanel.top, left: dayPanel.left }}
                >
                    <div className="flex justify-between items-center gap-2 mb-2">
                        <strong>{dayLabel(dayPanel.day)}</strong>
                        <button
                            type="button"
                            aria-label={t('upcoming.close')}
                            onClick={closePanel}
                        >
                            <XMarkIcon className="w-5 h-5" />
                        </button>
                    </div>
                    <div className="space-y-1">
                        {(tasksByDay.get(dayPanel.day) || []).map(taskChip)}
                    </div>
                    <button
                        type="button"
                        className="upcoming-nav mt-3"
                        onClick={() => openNewTask(dayPanel.day)}
                    >
                        {t('upcoming.addTask')}
                    </button>
                </div>
            )}
            {newTask && (
                <TaskModal
                    isOpen
                    task={newTask}
                    projects={projects}
                    showToast={false}
                    onClose={() => {
                        setNewTask(null);
                        void refreshTasks();
                    }}
                    onSave={async (task) => {
                        if (!task.name.trim()) {
                            showErrorToast(t('upcoming.nameRequired'));
                            throw new Error('Task name required');
                        }
                        try {
                            await createTask(task);
                            setActionError(null);
                        } catch (error) {
                            showErrorToast(t('upcoming.createError'));
                            throw error;
                        }
                    }}
                    onDelete={async () => {}}
                    onCreateProject={async (name) => {
                        const project = await createProject({ name });
                        setProjects((current) => [...current, project]);
                        return project;
                    }}
                />
            )}
        </div>
    );
};

export default UpcomingTasks;
