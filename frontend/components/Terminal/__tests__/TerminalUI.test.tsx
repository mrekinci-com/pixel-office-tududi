import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TerminalProvider } from '../TerminalConfig';
import TerminalPage from '../TerminalPage';
import TerminalPanel from '../TerminalPanel';
import TerminalUploadControl from '../TerminalUploadControl';
import SidebarNav from '../../Sidebar/SidebarNav';
import { Location } from 'react-router-dom';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
jest.mock('../../../store/useStore', () => ({
    useStore: () => ({ inboxStore: { pagination: { total: 0 } } }),
}));
jest.mock('../../../utils/inboxService', () => ({
    loadInboxItemsToStore: jest.fn().mockResolvedValue(undefined),
}));
const location: Location = {
    pathname: '/terminal',
    search: '',
    hash: '',
    state: null,
    key: 'terminal',
};
const config = {
    enabled: true,
    upload_enabled: true,
    base_url: '/terminal-proxy/',
    label: 'Workspace',
    cli: 'codex',
};
const originalFetch = global.fetch;
beforeEach(() => {
    global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, json: async () => config });
    localStorage.clear();
});
afterEach(() => {
    global.fetch = originalFetch;
});
function Harness({ onNavigate = jest.fn() }: { onNavigate?: jest.Mock }) {
    return (
        <TerminalProvider>
            <SidebarNav
                location={location}
                isDarkMode={false}
                openTaskModal={jest.fn()}
                handleNavClick={onNavigate}
            />
            <TerminalPage />
        </TerminalProvider>
    );
}
it('shares one authenticated config fetch, shows the menu and opens the same-origin Terminal page', async () => {
    const onNavigate = jest.fn();
    render(<Harness onNavigate={onNavigate} />);
    expect(
        screen.queryByRole('button', { name: 'Terminal' })
    ).not.toBeInTheDocument();
    const menu = await screen.findByRole('button', { name: 'Terminal' });
    fireEvent.click(menu);
    expect(onNavigate).toHaveBeenCalledWith(
        '/terminal',
        'Terminal',
        expect.anything()
    );
    expect(menu).toHaveClass('bg-gray-200');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
        '/api/terminal/config',
        expect.objectContaining({ credentials: 'include' })
    );
    expect(screen.getByTitle('Terminal')).toHaveAttribute(
        'src',
        '/terminal-proxy/'
    );
    expect(screen.getByTitle('Terminal')).toHaveAttribute(
        'allow',
        'clipboard-read; clipboard-write'
    );
    expect(screen.getByText('Codex on the host')).toBeInTheDocument();
    expect(screen.getByText(/Ctrl\/Cmd\+V/)).toBeInTheDocument();
    expect(
        screen.getByText(/Paste, drop or select images/)
    ).toBeInTheDocument();
    expect(
        screen.getByRole('link', { name: 'Open in new window' })
    ).toHaveAttribute('href', '/terminal-proxy/');
    expect(
        screen.getByRole('button', { name: 'Add image' })
    ).toBeInTheDocument();
});
it.each([401, 403, 404, 500])(
    'hides the menu, iframe and upload UI on HTTP %s',
    async (status) => {
        (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status });
        render(<Harness />);
        await screen.findByText('Terminal is not enabled for this account.');
        expect(
            screen.queryByRole('button', { name: 'Terminal' })
        ).not.toBeInTheDocument();
        expect(screen.queryByTitle('Terminal')).not.toBeInTheDocument();
        expect(
            screen.queryByRole('button', { name: 'Add image' })
        ).not.toBeInTheDocument();
    }
);
it.each([
    'https://evil.example/terminal-proxy/',
    '//evil.example/terminal-proxy/',
    '/\\evil.example/terminal-proxy/',
])('refuses a foreign iframe URL %s', async (url) => {
    (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ ...config, base_url: url }),
    });
    render(<Harness />);
    await screen.findByText('Terminal is not enabled for this account.');
    expect(screen.queryByTitle('Terminal')).not.toBeInTheDocument();
});
it('supports Claude Code as an informational hint and hides optional uploads', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ ...config, cli: 'claude', upload_enabled: false }),
    });
    render(<Harness />);
    await screen.findByText('Claude Code on the host');
    expect(
        screen.queryByRole('button', { name: 'Add image' })
    ).not.toBeInTheDocument();
    expect(
        screen.queryByText(/Paste, drop or select images/)
    ).not.toBeInTheDocument();
});
it('supports a validated legacy session argument without allowing arbitrary input', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ ...config, session_arg: 'legacy123' }),
    });
    render(<Harness />);
    expect(await screen.findByTitle('Terminal')).toHaveAttribute(
        'src',
        '/terminal-proxy/?arg=legacy123'
    );
});
it.each(['../bad', 'bad\nvalue', '--command', 'bad value'])(
    'refuses invalid legacy argument %p',
    async (arg) => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: true,
            json: async () => ({ ...config, session_arg: arg }),
        });
        render(<Harness />);
        await screen.findByText('Terminal is not enabled for this account.');
        expect(screen.queryByTitle('Terminal')).not.toBeInTheDocument();
    }
);
it('the picker submits selected files, resets its input and exposes upload status', () => {
    const upload = jest.fn();
    const view = render(
        <TerminalUploadControl
            enabled
            isUploading={false}
            status=""
            uploadFiles={upload}
        />
    );
    const input = screen.getByLabelText('Select images') as HTMLInputElement;
    const file = new File(['image'], 'image.png', { type: 'image/png' });
    const click = jest.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Add image' }));
    expect(click).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { files: [file] } });
    expect(upload).toHaveBeenCalledWith([file]);
    expect(input.value).toBe('');
    view.rerender(
        <TerminalUploadControl
            enabled
            isUploading
            status="Uploading image…"
            uploadFiles={upload}
        />
    );
    expect(screen.getByRole('button', { name: 'Add image' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Uploading image…');
});
it('keeps project content visible when closed and opens/resizes/closes the optional panel', async () => {
    const onClose = jest.fn();
    const view = render(
        <TerminalPanel
            baseUrl="/terminal-proxy/"
            isOpen={false}
            onClose={onClose}
        >
            <p>Project tasks</p>
        </TerminalPanel>
    );
    expect(screen.getByText('Project tasks')).toBeInTheDocument();
    expect(screen.queryByTitle('Terminal')).not.toBeInTheDocument();
    view.rerender(
        <TerminalPanel baseUrl="/terminal-proxy/" isOpen onClose={onClose}>
            <p>Project tasks</p>
        </TerminalPanel>
    );
    expect(screen.getByTitle('Terminal')).toHaveAttribute(
        'src',
        '/terminal-proxy/'
    );
    const separator = screen.getByRole('separator', {
        name: 'Resize Terminal panel',
    });
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', '70');
    expect(localStorage.getItem('terminal_width')).toBe('70');
    fireEvent.click(
        screen.getByRole('button', { name: 'Close Terminal panel' })
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});
