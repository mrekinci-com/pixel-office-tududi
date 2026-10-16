import React from 'react';
import { TextDecoder, TextEncoder } from 'util';
import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
} from '@testing-library/react';
import { TerminalInstance, useTerminalBridge } from '../TerminalBridge';

// jsdom lacks the encoding API that browsers (and the bridge) provide.
Object.assign(global, { TextEncoder, TextDecoder });

jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

function Harness({
    enabled = true,
    url = '/terminal-proxy/',
}: {
    enabled?: boolean;
    url?: string;
}) {
    const bridge = useTerminalBridge(true, url, enabled);
    // Match the real iframe: jsdom does not fetch this URL, so bind() controls
    // load events. Without src, its queued about:blank load races with uploads.
    return (
        <section ref={bridge.dropZoneRef} data-testid="drop-zone">
            <iframe
                ref={bridge.iframeRef}
                src={url}
                onLoad={bridge.onLoad}
                title="terminal"
            />
            <span role="status">{bridge.status}</span>
        </section>
    );
}

type MockTerm = {
    [Key in Exclude<keyof TerminalInstance, 'parser'>]: jest.Mock;
} & {
    parser?: { registerOscHandler: jest.Mock };
};
const makeTerm = (): MockTerm => ({
    attachCustomKeyEventHandler: jest.fn(),
    hasSelection: jest.fn(() => false),
    clearSelection: jest.fn(),
    paste: jest.fn(),
    focus: jest.fn(),
});
const png = () => new File(['png'], 'image.png', { type: 'image/png' });

function bind(term = makeTerm()) {
    const frame = screen.getByTitle('terminal') as HTMLIFrameElement;
    const frameWindow = frame.contentWindow as Window & {
        term: TerminalInstance;
    };
    frameWindow.term = term as unknown as TerminalInstance;
    const document = frameWindow.document;
    Object.defineProperty(document, 'execCommand', {
        value: jest.fn(() => true),
        configurable: true,
    });
    fireEvent.load(frame);
    return { term, frame, document };
}

function paste(document: Document, files: File[]) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
        value: {
            items: files.map((file) => ({
                kind: 'file',
                getAsFile: () => file,
            })),
            files,
        },
    });
    fireEvent(document, event);
    return event;
}
function drop(target: Document | HTMLElement, files: File[]) {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files } });
    fireEvent(target, event);
    return event;
}

const originalFetch = global.fetch;
beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ path: '/host/20261003-120000-00000001.png' }),
    });
});
afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
});

describe('useTerminalBridge', () => {
    it.each([
        { key: 'v', ctrlKey: true },
        { key: 'V', ctrlKey: true, shiftKey: true },
        { key: 'v', metaKey: true },
    ])(
        'leaves native paste available and suppresses xterm input: %p',
        (keys) => {
            render(<Harness />);
            const { term } = bind();
            const handler = term.attachCustomKeyEventHandler.mock.calls[0][0];
            const event = new KeyboardEvent('keydown', {
                ...keys,
                cancelable: true,
            });
            expect(handler(event)).toBe(false);
            expect(event.defaultPrevented).toBe(false);
            expect(handler(new KeyboardEvent('keyup', keys))).toBe(true);
        }
    );

    it.each([{ ctrlKey: true }, { metaKey: true }])(
        'copies selected text and preserves Ctrl+C without a selection: %p',
        (keys) => {
            render(<Harness />);
            const { term, document } = bind();
            const handler = term.attachCustomKeyEventHandler.mock.calls[0][0];
            const event = new KeyboardEvent('keydown', { key: 'c', ...keys });
            expect(handler(event)).toBe(true);
            expect(document.execCommand).not.toHaveBeenCalled();
            term.hasSelection.mockReturnValue(true);
            expect(handler(event)).toBe(false);
            expect(document.execCommand).toHaveBeenCalledWith('copy');
            expect(term.clearSelection).toHaveBeenCalledTimes(1);
        }
    );

    it('uploads image paste in capture phase and inserts the path without Enter', async () => {
        render(<Harness />);
        const { term, document } = bind();
        const nativePaste = jest.fn();
        document.addEventListener('paste', nativePaste);
        const file = png();
        expect(paste(document, [file]).defaultPrevented).toBe(true);
        expect(nativePaste).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent(
            'Uploading image…'
        );
        await waitFor(() =>
            expect(term.paste).toHaveBeenCalledWith(
                '/host/20261003-120000-00000001.png '
            )
        );
        const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
        expect(url).toBe('/api/terminal/upload');
        expect(options).toMatchObject({
            method: 'POST',
            credentials: 'include',
        });
        expect(options.body.get('image')).toBe(file);
        expect(term.focus).toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Image added');
    });

    it('does not interfere with text paste or non-image files', () => {
        render(<Harness />);
        const { document, term } = bind();
        const nativePaste = jest.fn();
        document.addEventListener('paste', nativePaste);
        expect(paste(document, []).defaultPrevented).toBe(false);
        expect(
            paste(document, [
                new File(['text'], 'note.txt', { type: 'text/plain' }),
            ]).defaultPrevented
        ).toBe(false);
        expect(nativePaste).toHaveBeenCalledTimes(2);
        expect(global.fetch).not.toHaveBeenCalled();
        expect(term.paste).not.toHaveBeenCalled();
    });

    it.each([
        '/host/20261003-120000-0000000a.png\n',
        '/host/x\u0003y.png',
        '/host/\u001b[201~\r.png',
        'relative.png',
    ])(
        'never types an invalid server path into the terminal: %p',
        async (bad) => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: true,
                json: async () => ({ path: bad }),
            });
            render(<Harness />);
            const { term, document } = bind();
            paste(document, [png()]);
            await waitFor(() =>
                expect(screen.getByRole('status')).toHaveTextContent(
                    'Image could not be uploaded'
                )
            );
            expect(term.paste).not.toHaveBeenCalled();
        }
    );

    it('copies OSC 52 clipboard sequences from tmux to the browser clipboard', () => {
        render(<Harness />);
        const dispose = jest.fn();
        const term: MockTerm = {
            ...makeTerm(),
            parser: { registerOscHandler: jest.fn(() => ({ dispose })) },
        };
        const { document } = bind(term);
        const register = term.parser!.registerOscHandler;
        expect(register).toHaveBeenCalledWith(52, expect.any(Function));
        const handler = register.mock.calls[0][1];
        if (!document.documentElement)
            document.appendChild(document.createElement('html'));
        let copied = '';
        (document.execCommand as jest.Mock).mockImplementation(() => {
            copied = (
                document.querySelector(
                    'textarea[readonly]'
                ) as HTMLTextAreaElement
            ).value;
            return true;
        });
        const b64 = btoa(
            String.fromCharCode(...new TextEncoder().encode('Merhaba şirket'))
        );
        expect(handler('c;' + b64)).toBe(true);
        expect(document.execCommand).toHaveBeenCalledWith('copy');
        expect(copied).toBe('Merhaba şirket');
        expect(document.querySelector('textarea[readonly]')).toBeNull();
        expect(handler('c;?')).toBe(true);
        expect(handler('c;%%%')).toBe(true);
        expect(document.execCommand).toHaveBeenCalledTimes(1);
    });

    it.each(['iframe', 'container'])(
        'uploads multiple dropped images sequentially from the %s',
        async (target) => {
            render(<Harness />);
            const { document, term } = bind();
            let resolveFirst: (response: unknown) => void;
            (global.fetch as jest.Mock)
                .mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            resolveFirst = resolve;
                        })
                )
                .mockResolvedValueOnce({
                    ok: true,
                    json: async () => ({
                        path: '/host/20261003-120000-00000002.jpg',
                    }),
                });
            expect(
                drop(
                    target === 'iframe'
                        ? document
                        : screen.getByTestId('drop-zone'),
                    [
                        png(),
                        new File(['jpeg'], 'second.jpg', {
                            type: 'image/jpeg',
                        }),
                    ]
                ).defaultPrevented
            ).toBe(true);
            await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
            await act(async () =>
                resolveFirst({
                    ok: true,
                    json: async () => ({
                        path: '/host/20261003-120000-00000003.png',
                    }),
                })
            );
            await waitFor(() => expect(term.paste).toHaveBeenCalledTimes(2));
            expect(term.paste.mock.calls).toEqual([
                ['/host/20261003-120000-00000003.png '],
                ['/host/20261003-120000-00000002.jpg '],
            ]);
        }
    );

    it.each<[number, string]>([
        [401, 'Session expired'],
        [403, 'permission'],
        [404, 'disabled'],
        [413, '15 MB'],
        [415, 'PNG, JPEG, GIF or WebP'],
        [500, 'could not be uploaded'],
    ])(
        'shows HTTP %s errors outside the terminal',
        async (statusCode, text) => {
            (global.fetch as jest.Mock).mockResolvedValue({
                ok: false,
                status: statusCode,
            });
            render(<Harness />);
            const { document, term } = bind();
            paste(document, [png()]);
            await waitFor(() =>
                expect(screen.getByRole('status')).toHaveTextContent(text)
            );
            expect(term.paste).not.toHaveBeenCalled();
            expect(term.focus).toHaveBeenCalled();
        }
    );

    it('rejects oversized images before uploading', async () => {
        render(<Harness />);
        const { document, term } = bind();
        const file = png();
        Object.defineProperty(file, 'size', { value: 15 * 1024 * 1024 + 1 });
        paste(document, [file]);
        await waitFor(() =>
            expect(screen.getByRole('status')).toHaveTextContent('15 MB')
        );
        expect(global.fetch).not.toHaveBeenCalled();
        expect(term.paste).not.toHaveBeenCalled();
    });

    it('leaves image events alone when uploads are disabled', () => {
        render(<Harness enabled={false} />);
        const { document } = bind();
        expect(paste(document, [png()]).defaultPrevented).toBe(false);
        expect(drop(document, [png()]).defaultPrevented).toBe(false);
        expect(
            drop(screen.getByTestId('drop-zone'), [png()]).defaultPrevented
        ).toBe(false);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('waits for term with a bounded retry count', () => {
        const view = render(<Harness />);
        act(() => jest.advanceTimersByTime(10000));
        expect(jest.getTimerCount()).toBe(0);
        const { term } = bind();
        expect(term.attachCustomKeyEventHandler).toHaveBeenCalledTimes(1);
        view.unmount();
        expect(jest.getTimerCount()).toBe(0);
    });

    it('rebinds on reload and replacement, and cleans up on unmount', async () => {
        const view = render(<Harness />);
        const { frame, document, term } = bind();
        fireEvent.load(frame);
        expect(term.attachCustomKeyEventHandler).toHaveBeenCalledTimes(3);
        const replacement = makeTerm();
        (frame.contentWindow as Window & { term: TerminalInstance }).term =
            replacement;
        act(() => jest.advanceTimersByTime(1000));
        expect(replacement.attachCustomKeyEventHandler).toHaveBeenCalledTimes(
            1
        );
        paste(document, [png()]);
        await waitFor(() => expect(replacement.paste).toHaveBeenCalledTimes(1));
        expect(term.paste).not.toHaveBeenCalled();
        view.unmount();
        expect(paste(document, [png()]).defaultPrevented).toBe(false);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
    });

    it.each(['reload', 'session switch', 'unmount'])(
        'aborts pending uploads and avoids stale insertion on %s',
        async (change) => {
            let resolveUpload: (response: unknown) => void;
            (global.fetch as jest.Mock).mockImplementation(
                () =>
                    new Promise((resolve) => {
                        resolveUpload = resolve;
                    })
            );
            const view = render(<Harness />);
            const { frame, document, term } = bind();
            paste(document, [png()]);
            await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
            const signal = (global.fetch as jest.Mock).mock.calls[0][1].signal;
            if (change === 'unmount') view.unmount();
            else if (change === 'reload') fireEvent.load(frame);
            else view.rerender(<Harness url="/terminal-proxy/?view=other" />);
            expect(signal.aborted).toBe(true);
            await act(async () =>
                resolveUpload({
                    ok: true,
                    json: async () => ({
                        path: '/host/20261003-120000-00000004.png',
                    }),
                })
            );
            expect(term.paste).not.toHaveBeenCalled();
        }
    );
});
