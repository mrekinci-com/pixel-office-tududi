import React from 'react';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import UpcomingTasks from '../UpcomingTasks';
import { Task } from '../../../entities/Task';
import { VIEW_KEY, PROJECTS_KEY } from '../upcomingDates';

jest.mock('../../Shared/ToastContext', () => ({
    useToast: () => ({ showErrorToast: jest.fn() }),
}));

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));
// Exercise the existing modal's initial task/onSave/onClose contract without its unrelated services.
jest.mock('../../Task/TaskModal', () => ({
    __esModule: true,
    default: ({ task, onSave, onClose }: any) => (
        <div role="dialog" aria-label="New task">
            <output data-testid="initial-due-date">{task.due_date}</output>
            <button
                onClick={async () => {
                    await onSave({ ...task, name: 'Yeni görev' });
                    onClose();
                }}
            >
                Save new task
            </button>
            <button onClick={onClose}>Cancel new task</button>
        </div>
    ),
}));

import tr from '../../../../public/locales/tr/translation.json';
import en from '../../../../public/locales/en/translation.json';
const i18n = createInstance();
void i18n.init({
    lng: 'tr',
    fallbackLng: 'en',
    resources: { tr: { translation: tr }, en: { translation: en } },
    interpolation: { escapeValue: false },
});

const task = (
    uid: string,
    name: string,
    day?: string,
    status: Task['status'] = 0,
    projectId = 1
): Task => ({
    id: Number(uid.replace(/\D/g, '')) || 1,
    uid,
    name,
    due_date: day,
    status,
    project_id: projectId,
    completed_at: null,
});
const fixtures = [
    task('t1', 'Geciken kontrol', '2026-10-05'),
    task('t2', 'Bugünkü kontrol', '2026-10-07'),
    task('t3', 'Yarınki kontrol', '2026-10-08'),
    task('t4', 'Haftalık kontrol', '2026-10-09'),
    task('t5', 'Sonraki hafta kontrolü', '2026-10-12'),
    task('t6', 'Aylık kontrol', '2026-10-20'),
    task('t7', 'İleri tarihli kontrol', '2027-02-20', 0, 2),
    task('t8', 'Biten kontrol', '2026-10-07', 'done'),
    task('t9', 'Tarihsiz kontrol'),
];
const response = (data: unknown, ok = true) =>
    ({ ok, json: async () => data }) as Response;
let taskData: Task[];
let patchResult: () => Promise<Response>;

const showPage = () =>
    render(
        <I18nextProvider i18n={i18n}>
            <UpcomingTasks />
        </I18nextProvider>
    );
const cell = (container: HTMLElement, day: string) =>
    container.querySelector(`[data-date="${day}"]`) as HTMLElement;
const dropOn = (container: HTMLElement, uid: string, day: string) =>
    fireEvent.drop(cell(container, day), {
        dataTransfer: {
            getData: (type: string) =>
                type === 'application/x-tududi-task' ? uid : '',
        },
    });

beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout'] });
    jest.setSystemTime(new Date('2026-10-07T12:00:00Z'));
    localStorage.clear();
    Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: 1024,
    });
    taskData = fixtures.map((item) => ({ ...item }));
    patchResult = async () => response({});
    mockNavigate.mockClear();
    global.fetch = jest.fn(async (url: string, options?: RequestInit) => {
        if (options?.method === 'PATCH') return patchResult();
        if (options?.method === 'POST') {
            const created = {
                ...JSON.parse(options.body as string),
                uid: 't10',
                id: 10,
            };
            taskData = [...taskData, created];
            return response(created);
        }
        if (url === '/api/projects')
            return response([
                { id: 1, uid: 'p1', name: 'Örnek Proje' },
                { id: 2, uid: 'p2', name: 'Diğer proje' },
            ]);
        return response({ tasks: taskData });
    }) as jest.Mock;
});
afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

it('loads all tasks once, defaults to calendar on desktop and uses Turkish dates', async () => {
    const { container } = showPage();
    expect(await screen.findByText('Ekim 2026')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledWith(
        '/api/tasks?type=all&client_side_filtering=true',
        expect.anything()
    );
    expect(
        (global.fetch as jest.Mock).mock.calls.filter(([url]) =>
            url.startsWith('/api/tasks')
        )
    ).toHaveLength(1);
    expect(container.querySelectorAll('[data-date]')).toHaveLength(42);
    expect(screen.getByText('Pazartesi')).toBeInTheDocument();
    expect(cell(container, '2026-10-07')).toHaveClass('is-today');
    expect(
        screen.queryByRole('button', { name: 'Biten kontrol' })
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Tarihsiz kontrol')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sonraki ay' }));
    expect(screen.getByText('Kasım 2026')).toBeInTheDocument();
    expect(container.querySelector('[data-date]')).toHaveAttribute(
        'data-date',
        '2026-10-26'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bugün' }));
    expect(screen.getByText('Ekim 2026')).toBeInTheDocument();
    for (let i = 0; i < 12; i++)
        fireEvent.click(screen.getByRole('button', { name: 'Sonraki ay' }));
    expect(screen.getByText('Ekim 2027')).toBeInTheDocument();
});

it('defaults to agenda on phones, groups dated tasks and summarizes unfinished work', async () => {
    Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: 375,
    });
    showPage();
    await screen.findByRole('button', { name: /Bugünkü kontrol/ });
    expect(screen.getByRole('button', { name: 'Ajanda' })).toHaveAttribute(
        'aria-pressed',
        'true'
    );
    [
        'Gecikmiş',
        'Bugün',
        'Yarın',
        'Bu hafta',
        'Gelecek hafta',
        'Bu ay',
        'Sonra',
    ].forEach((name) =>
        expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    );
    expect(screen.getByText('2 gün gecikti')).toBeInTheDocument();
    expect(screen.getByText('Gecikmiş 1')).toBeInTheDocument();
    expect(screen.getByText('Bu hafta 4')).toBeInTheDocument();
    expect(screen.getByText('Önümüzdeki 30 gün 5')).toBeInTheDocument();
    expect(screen.queryByText('Tarihsiz kontrol')).not.toBeInTheDocument();
    expect(screen.queryByText('Biten kontrol')).not.toBeInTheDocument();
    fireEvent.click(
        screen.getByRole('switch', { name: 'Tamamlananları göster' })
    );
    const completed = screen.getByRole('button', { name: /Biten kontrol/ });
    expect(completed).toHaveClass('is-completed');
    expect(screen.getByText('Gecikmiş 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Bugünkü kontrol/ }));
    expect(mockNavigate).toHaveBeenCalledWith('/task/t2');
});

it('jumps from the overdue summary to the agenda overdue group', async () => {
    showPage();
    await screen.findByText('Ekim 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Gecikmiş 1' }));
    expect(screen.getByRole('button', { name: 'Ajanda' })).toHaveAttribute(
        'aria-pressed',
        'true'
    );
    expect(screen.getByRole('region', { name: 'Gecikmiş' })).toHaveFocus();
});

it('persists the view and hidden projects across remounts and shows zero summaries', async () => {
    const first = showPage();
    await screen.findByText('Ekim 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Örnek Proje' }));
    expect(localStorage.getItem(PROJECTS_KEY)).toBe('["1"]');
    expect(
        screen.queryByRole('button', { name: 'Bugünkü kontrol' })
    ).not.toBeInTheDocument();
    expect(screen.getByText('Gecikmiş 0')).toBeInTheDocument();
    expect(screen.getByText('Bu hafta 0')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ajanda' }));
    expect(localStorage.getItem(VIEW_KEY)).toBe('agenda');
    first.unmount();
    showPage();
    await screen.findByRole('button', { name: /İleri tarihli kontrol/ });
    expect(screen.getByRole('button', { name: 'Örnek Proje' })).toHaveAttribute(
        'aria-pressed',
        'false'
    );
    expect(
        screen.queryByRole('heading', { name: 'Gecikmiş' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Örnek Proje' }));
    expect(
        screen.getByRole('button', { name: /Bugünkü kontrol/ })
    ).toBeInTheDocument();
});

it('shows completed chips only with the switch and navigates chips to existing task details', async () => {
    showPage();
    await screen.findByText('Ekim 2026');
    fireEvent.click(
        screen.getByRole('switch', { name: 'Tamamlananları göster' })
    );
    expect(screen.getByRole('button', { name: 'Biten kontrol' })).toHaveClass(
        'is-completed'
    );
    expect(screen.getByRole('button', { name: 'Geciken kontrol' })).toHaveClass(
        'is-overdue'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Bugünkü kontrol' }));
    expect(mockNavigate).toHaveBeenCalledWith('/task/t2');
    fireEvent.click(
        screen.getByRole('switch', { name: 'Tamamlananları göster' })
    );
    expect(
        screen.queryByRole('button', { name: 'Biten kontrol' })
    ).not.toBeInTheDocument();
});

it('shows overflow tasks in a keyboard-dismissible day panel', async () => {
    taskData = Array.from({ length: 5 }, (_, i) =>
        task(`t${i + 1}`, `Görev ${i + 1}`, '2026-10-07')
    );
    const { container } = showPage();
    await screen.findByText('Ekim 2026');
    const more = within(cell(container, '2026-10-07')).getByRole('button', {
        name: '+2 daha',
    });
    expect(
        screen.queryByRole('button', { name: 'Görev 5' })
    ).not.toBeInTheDocument();
    fireEvent.click(more);
    const panel = screen.getByRole('dialog');
    expect(
        within(panel).getByRole('button', { name: 'Görev 5' })
    ).toBeInTheDocument();
    expect(panel).toHaveFocus();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(more).toHaveFocus();
});

it('prefills creation with the clicked date and refreshes after saving/closing the existing modal', async () => {
    const { container } = showPage();
    await screen.findByText('Ekim 2026');
    fireEvent.click(
        cell(container, '2026-10-16').querySelector('.upcoming-add-day')!
    );
    expect(screen.getByTestId('initial-due-date')).toHaveTextContent(
        '2026-10-16'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save new task' }));
    await screen.findByRole('button', { name: 'Yeni görev' });
    const post = (global.fetch as jest.Mock).mock.calls.find(
        ([, options]) => options?.method === 'POST'
    );
    expect(post[0]).toBe('/api/task');
    expect(JSON.parse(post[1].body)).toEqual(
        expect.objectContaining({ name: 'Yeni görev', due_date: '2026-10-16' })
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('moves optimistically using only a due_date PATCH and retains status', async () => {
    let resolvePatch: (value: Response) => void;
    patchResult = () =>
        new Promise((resolve) => {
            resolvePatch = resolve;
        });
    const { container } = showPage();
    await screen.findByText('Ekim 2026');
    const chip = screen.getByRole('button', { name: 'Bugünkü kontrol' });
    const setData = jest.fn();
    fireEvent.dragStart(chip, { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith('application/x-tududi-task', 't2');
    dropOn(container, 't2', '2026-10-14');
    expect(
        within(cell(container, '2026-10-14')).getByRole('button', {
            name: 'Bugünkü kontrol',
        })
    ).toBeDisabled();
    expect(
        within(cell(container, '2026-10-07')).queryByRole('button', {
            name: 'Bugünkü kontrol',
        })
    ).not.toBeInTheDocument();
    const patch = (global.fetch as jest.Mock).mock.calls.find(
        ([, options]) => options?.method === 'PATCH'
    );
    expect(patch[0]).toBe('/api/task/t2');
    expect(JSON.parse(patch[1].body)).toEqual({ due_date: '2026-10-14' });
    await act(async () =>
        resolvePatch(response({ status: 0, due_date: '2026-10-14' }))
    );
    expect(
        within(cell(container, '2026-10-14')).getByRole('button', {
            name: 'Bugünkü kontrol',
        })
    ).toBeEnabled();
});

it.each(['http', 'network'])(
    'rolls back a failed %s move with a short error',
    async (failure) => {
        patchResult =
            failure === 'http'
                ? async () => response({}, false)
                : async () => {
                      throw new Error('offline');
                  };
        const { container } = showPage();
        await screen.findByText('Ekim 2026');
        dropOn(container, 't2', '2026-10-14');
        await screen.findByRole('alert');
        expect(
            within(cell(container, '2026-10-07')).getByRole('button', {
                name: 'Bugünkü kontrol',
            })
        ).toBeEnabled();
        expect(
            within(cell(container, '2026-10-14')).queryByRole('button', {
                name: 'Bugünkü kontrol',
            })
        ).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent(
            'Önceki tarih geri yüklendi.'
        );
    }
);

it('defers a refresh requested during a move until the move is saved', async () => {
    let resolvePatch: (value: Response) => void;
    patchResult = () =>
        new Promise((resolve) => {
            resolvePatch = resolve;
        });
    const { container } = showPage();
    await screen.findByText('Ekim 2026');
    const reads = () =>
        (global.fetch as jest.Mock).mock.calls.filter(
            ([url, options]) =>
                String(url).includes('tasks?type=all') && !options?.method
        ).length;
    const before = reads();
    dropOn(container, 't2', '2026-10-14');
    // Server still reports the old date while the PATCH is in flight.
    fireEvent(window, new CustomEvent('taskUpdated'));
    fireEvent.focus(window);
    expect(reads()).toBe(before);
    taskData = taskData.map((item) =>
        item.uid === 't2' ? { ...item, due_date: '2026-10-14' } : item
    );
    await act(async () =>
        resolvePatch(response({ status: 0, due_date: '2026-10-14' }))
    );
    await waitFor(() => expect(reads()).toBe(before + 1));
    expect(
        within(cell(container, '2026-10-14')).getByRole('button', {
            name: 'Bugünkü kontrol',
        })
    ).toBeEnabled();
});

it('refreshes on task changes and window focus', async () => {
    showPage();
    await screen.findByText('Ekim 2026');
    taskData = [...taskData, task('t10', 'Dışarıda oluşturulan', '2026-10-16')];
    fireEvent(window, new CustomEvent('taskCreated'));
    await screen.findByRole('button', { name: 'Dışarıda oluşturulan' });
    taskData = taskData.filter((item) => item.uid !== 't10');
    fireEvent.focus(window);
    await waitFor(() =>
        expect(
            screen.queryByRole('button', { name: 'Dışarıda oluşturulan' })
        ).not.toBeInTheDocument()
    );
});
