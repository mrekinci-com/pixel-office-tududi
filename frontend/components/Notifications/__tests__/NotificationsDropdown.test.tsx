import React from 'react';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotificationsDropdown from '../NotificationsDropdown';
import {
    deleteTask,
    toggleTaskCompletion,
    updateTask,
} from '../../../utils/tasksService';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback: string) => fallback || key,
    }),
}));
jest.mock('../../../i18n', () => ({ language: 'en' }));

describe('Notifications refresh after task changes', () => {
    const originalFetch = global.fetch;
    let read: boolean;
    let failMutation: boolean;

    beforeEach(() => {
        jest.useFakeTimers();
        read = false;
        failMutation = false;
        global.fetch = jest.fn(async (url, options) => {
            const path = String(url);
            if (path.endsWith('/task/task-uid')) {
                if (failMutation) return { ok: false, status: 400 } as Response;
                if (options?.method === 'PATCH' || options?.method === 'DELETE')
                    read = true;
                return {
                    ok: true,
                    json: async () => ({
                        uid: 'task-uid',
                        status: read ? 2 : 0,
                    }),
                } as Response;
            }
            if (path.includes('unread-count')) {
                return {
                    ok: true,
                    json: async () => ({ count: read ? 0 : 1 }),
                } as Response;
            }
            return {
                ok: true,
                json: async () => ({
                    notifications: [
                        {
                            id: 1,
                            title: 'Due reminder',
                            message: 'Task due soon',
                            level: 'warning',
                            is_read: read,
                            created_at: new Date().toISOString(),
                            data: { taskUid: 'task-uid' },
                        },
                    ],
                }),
            } as Response;
        }) as jest.MockedFunction<typeof fetch>;
    });

    afterEach(() => {
        global.fetch = originalFetch;
        jest.useRealTimers();
    });

    const openDropdown = async () => {
        render(
            <MemoryRouter>
                <NotificationsDropdown isDarkMode={false} />
            </MemoryRouter>
        );
        fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
        await screen.findByTitle('Mark as read');
        expect(
            screen.getByRole('button', { name: 'Notifications' })
        ).toHaveTextContent('1');
    };

    const expectRefreshed = async () => {
        await waitFor(() =>
            expect(screen.queryByTitle('Mark as read')).not.toBeInTheDocument()
        );
        // Read notifications leave the list so it matches the bell count.
        expect(screen.queryByText('Due reminder')).not.toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Notifications' })
        ).not.toHaveTextContent('1');
    };

    it.each(['completion', 'archive', 'delete'])(
        'refreshes the open list and badge immediately after %s',
        async (operation) => {
            await openDropdown();
            await act(async () => {
                if (operation === 'completion')
                    await toggleTaskCompletion('task-uid');
                if (operation === 'archive')
                    await updateTask('task-uid', { status: 3 });
                if (operation === 'delete') await deleteTask('task-uid');
            });
            await expectRefreshed();
        }
    );

    it('polls the open list as well as the badge for changes from another client', async () => {
        await openDropdown();
        read = true;
        await act(async () => {
            jest.advanceTimersByTime(30000);
        });
        await expectRefreshed();
    });

    it('keeps notifications unread if the task mutation fails', async () => {
        await openDropdown();
        failMutation = true;
        const callsBefore = (global.fetch as jest.Mock).mock.calls.length;
        await act(async () => {
            await expect(updateTask('task-uid', { status: 2 })).rejects.toThrow(
                'Failed to update task.'
            );
        });
        expect((global.fetch as jest.Mock).mock.calls.length).toBe(
            callsBefore + 1
        );
        expect(screen.getByTitle('Mark as read')).toBeInTheDocument();
    });
});
