import React from 'react';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import {
    render,
    fireEvent,
    screen,
    waitFor,
    cleanup,
} from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import Navbar from '../Navbar';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback: string) => fallback || key,
    }),
}));
jest.mock('@heroicons/react/24/solid', () => ({
    UserIcon: () => <span data-testid="user-icon" />,
    Bars3Icon: () => null,
    BoltIcon: () => null,
    InboxIcon: () => null,
}));
jest.mock('@heroicons/react/24/outline', () => ({
    EnvelopeIcon: () => null,
    MagnifyingGlassIcon: () => null,
}));
jest.mock('../Shared/PomodoroTimer', () => () => null);
jest.mock('../UniversalSearch/UniversalSearch', () => () => null);
jest.mock('../Notifications/NotificationsDropdown', () => () => null);

const originalLocation = window.location;
const originalFetch = global.fetch;
let assign: ReturnType<typeof jest.fn>;
let clearUser: ReturnType<typeof jest.fn>;

beforeEach(() => {
    assign = jest.fn();
    clearUser = jest.fn();
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { hostname: 'panel.example.test', assign },
    });
    global.fetch = jest.fn(async (url: any) => ({
        ok: true,
        json: async () =>
            String(url).endsWith('/profile')
                ? { pomodoro_enabled: false }
                : { message: 'Logged out successfully' },
    })) as any;
});

afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
    });
    global.fetch = originalFetch;
    jest.restoreAllMocks();
});

function CurrentPath() {
    return <output data-testid="path">{useLocation().pathname}</output>;
}

function mount() {
    render(
        <MemoryRouter initialEntries={['/']}>
            <Navbar
                isDarkMode={false}
                toggleDarkMode={() => {}}
                currentUser={{ email: 'owner@example.test' }}
                setCurrentUser={clearUser as any}
                isSidebarOpen={false}
                setIsSidebarOpen={() => {}}
                openTaskModal={() => {}}
            />
            <CurrentPath />
        </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId('user-icon').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
}

test('public logout clears the user and opens the Tududi password login', async () => {
    mount();
    await waitFor(() =>
        expect(screen.getByTestId('path').textContent).toBe('/login')
    );
    expect(assign).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith('/api/logout', {
        method: 'GET',
        credentials: 'include',
    });
    expect(clearUser).toHaveBeenCalledWith(null);
    expect(screen.getByTestId('path').textContent).toBe('/login');
});

test('private logout preserves existing password login navigation', async () => {
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: { hostname: '127.0.0.1', assign },
    });
    mount();
    await waitFor(() =>
        expect(screen.getByTestId('path').textContent).toBe('/login')
    );
    expect(assign).not.toHaveBeenCalled();
});

test('failed logout does not clear user or navigate to another entry page', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest.fn(async (url: any) => ({
        ok: !String(url).endsWith('/logout'),
        json: async () => ({}),
    })) as any;
    mount();
    await waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(clearUser).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByTestId('path').textContent).toBe('/');
});
