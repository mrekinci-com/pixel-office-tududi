import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiPath } from '../../config/paths';

export interface TerminalInstance {
    attachCustomKeyEventHandler: (
        handler: (event: KeyboardEvent) => boolean
    ) => void;
    hasSelection: () => boolean;
    clearSelection: () => void;
    paste: (text: string) => void;
    focus: () => void;
    parser?: {
        registerOscHandler: (
            ident: number,
            callback: (data: string) => boolean
        ) => { dispose: () => void };
    };
}

// The host CLI can select with its own mouse handling and copy through tmux,
// which forwards the text as an OSC 52 clipboard sequence. xterm.js ignores
// OSC 52 by default, so write it to the browser clipboard here. The sequence
// follows the user's mouse selection, so the copy runs with user activation.
function copyFromOsc52(document: Document, data: string): boolean {
    const payload = data.slice(data.indexOf(';') + 1);
    if (!payload || payload === '?') return true;
    let text: string;
    try {
        const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
        text = new TextDecoder().decode(bytes);
    } catch {
        return true;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    const previous = document.activeElement as HTMLElement | null;
    const host = document.body || document.documentElement;
    if (!host) return true;
    host.appendChild(area);
    try {
        area.select();
        document.execCommand('copy');
    } catch {
        // Copying is best effort; the terminal keeps working without it.
    } finally {
        area.remove();
        previous?.focus();
    }
    return true;
}

type TerminalWindow = Window & { term?: TerminalInstance };
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
// Only a plain absolute path to a server-named image may be typed into the
// terminal; anything else (control characters, line breaks) is rejected.
const UPLOAD_PATH =
    /^\/[A-Za-z0-9._/-]+\/\d{8}-\d{6}-[a-f0-9]{8}\.(png|jpg|gif|webp)$/;
class TerminalUploadError extends Error {}
const isImage = (file: File) =>
    file.type.startsWith('image/') ||
    (!file.type && /\.(png|jpe?g|gif|webp)$/i.test(file.name));

function clipboardImages(data: DataTransfer | null): File[] {
    if (!data) return [];
    const files = Array.from(data.items || [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => !!file && isImage(file));
    return files.length ? files : Array.from(data.files || []).filter(isImage);
}

export function useTerminalBridge(
    active: boolean,
    terminalUrl: string,
    uploadEnabled: boolean
) {
    const { t } = useTranslation();
    const translate = useRef(t);
    translate.current = t;
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const dropZoneRef = useRef<HTMLElement>(null);
    const bridgeRef = useRef<{
        connect: () => void;
        enqueue: (files: File[]) => void;
    } | null>(null);
    const [status, setStatus] = useState('');
    const [isUploading, setIsUploading] = useState(false);

    useEffect(() => {
        if (!active) return;
        let disposed = false;
        let generation = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let watcher: ReturnType<typeof setInterval> | undefined;
        let detach = () => {};
        let controller = new AbortController();
        let connection: { term: TerminalInstance; document: Document } | null =
            null;
        let queue = Promise.resolve();
        let pending = 0;
        const message = (key: string, fallback: string) =>
            translate.current(`terminal.${key}`, fallback);
        const uploadError = (statusCode: number) => {
            if (statusCode === 413) {
                return message(
                    'imageTooLarge',
                    'Image must be 15 MB or smaller.'
                );
            }
            if (statusCode === 415) {
                return message(
                    'imageType',
                    'Use a PNG, JPEG, GIF or WebP image.'
                );
            }
            if (statusCode === 401) {
                return message(
                    'imageSession',
                    'Session expired. Please sign in again.'
                );
            }
            if (statusCode === 403) {
                return message(
                    'imageForbidden',
                    'You do not have permission to upload images.'
                );
            }
            if (statusCode === 404) {
                return message('imageDisabled', 'Image uploads are disabled.');
            }
            return message(
                'imageError',
                'Image could not be uploaded. Please try again.'
            );
        };
        const enqueue = (files: File[]) => {
            if (!uploadEnabled || !files.length || disposed) return;
            const target = connection;
            if (!target) {
                setStatus(
                    message(
                        'terminalNotReady',
                        'Terminal is not ready yet. Please try again.'
                    )
                );
                return;
            }
            const jobGeneration = generation;
            const signal = controller.signal;
            pending += 1;
            setIsUploading(true);
            setStatus(message('imageUploading', 'Uploading image…'));
            queue = queue.then(async () => {
                if (disposed || jobGeneration !== generation) return;
                setStatus(message('imageUploading', 'Uploading image…'));
                try {
                    for (const file of files) {
                        if (file.size > MAX_IMAGE_BYTES) {
                            throw new TerminalUploadError(uploadError(413));
                        }
                        const body = new FormData();
                        body.append('image', file);
                        const response = await fetch(
                            getApiPath('terminal/upload'),
                            {
                                method: 'POST',
                                credentials: 'include',
                                body,
                                signal,
                            }
                        );
                        if (!response.ok) {
                            throw new TerminalUploadError(
                                uploadError(response.status)
                            );
                        }
                        const result = await response.json();
                        if (
                            typeof result.path !== 'string' ||
                            !UPLOAD_PATH.test(result.path) ||
                            result.path !== result.path.trim() ||
                            result.path.includes('//') ||
                            result.path
                                .split('/')
                                .some(
                                    (part: string) =>
                                        part === '.' || part === '..'
                                )
                        ) {
                            throw new TerminalUploadError(uploadError(500));
                        }
                        // A reload/session switch must never insert a stale path into
                        // a new terminal. Each file is sent without submitting Enter.
                        if (disposed || jobGeneration !== generation) return;
                        target.term.paste(result.path + ' ');
                    }
                    setStatus(message('imageAdded', 'Image added'));
                } catch (error) {
                    if (!disposed && jobGeneration === generation) {
                        setStatus(
                            error instanceof TerminalUploadError
                                ? error.message
                                : uploadError(500)
                        );
                    }
                } finally {
                    if (!disposed && jobGeneration === generation) {
                        pending -= 1;
                        setIsUploading(pending > 0);
                        target.term.focus();
                    }
                }
            });
        };
        const onDrop = (event: DragEvent) => {
            if (!uploadEnabled) return;
            const files = Array.from(event.dataTransfer?.files || []).filter(
                isImage
            );
            if (!files.length) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            enqueue(files);
        };
        const onDragOver = (event: DragEvent) => {
            if (!uploadEnabled) return;
            const data = event.dataTransfer;
            if (
                Array.from(data?.items || []).some(
                    (item) =>
                        item.kind === 'file' &&
                        (!item.type || item.type.startsWith('image/'))
                )
            ) {
                event.preventDefault();
                if (data) data.dropEffect = 'copy';
            }
        };
        const dropZone = dropZoneRef.current;
        dropZone?.addEventListener('drop', onDrop);
        dropZone?.addEventListener('dragover', onDragOver);

        const connect = () => {
            if (disposed) return;
            generation += 1;
            controller.abort();
            controller = new AbortController();
            clearTimeout(timer);
            clearInterval(watcher);
            detach();
            connection = null;
            queue = Promise.resolve();
            pending = 0;
            setIsUploading(false);
            setStatus('');
            let attempts = 0;
            const poll = () => {
                if (disposed) return;
                attempts += 1;
                try {
                    const frameWindow = iframeRef.current
                        ?.contentWindow as TerminalWindow | null;
                    const document = frameWindow?.document;
                    const term = frameWindow?.term;
                    if (document && term?.attachCustomKeyEventHandler) {
                        connection = { term, document };
                        term.attachCustomKeyEventHandler((event) => {
                            if (
                                event.type !== 'keydown' ||
                                !(event.ctrlKey || event.metaKey) ||
                                event.altKey
                            ) {
                                return true;
                            }
                            const key = event.key.toLowerCase();
                            // Let the browser dispatch paste; do not preventDefault.
                            if (key === 'v') return false;
                            if (key === 'c' && term.hasSelection()) {
                                try {
                                    document.execCommand('copy');
                                } catch {
                                    // Still consume the shortcut if browser copy fails.
                                } finally {
                                    term.clearSelection();
                                }
                                return false;
                            }
                            return true;
                        });
                        const onPaste = (event: ClipboardEvent) => {
                            if (!uploadEnabled) return;
                            const files = clipboardImages(event.clipboardData);
                            if (!files.length) return;
                            event.preventDefault();
                            // xterm's own paste listener must not consume image data.
                            event.stopImmediatePropagation();
                            enqueue(files);
                        };
                        const osc52 = term.parser?.registerOscHandler(
                            52,
                            (data) => copyFromOsc52(document, data)
                        );
                        document.addEventListener('paste', onPaste, true);
                        document.addEventListener('drop', onDrop, true);
                        document.addEventListener('dragover', onDragOver, true);
                        detach = () => {
                            osc52?.dispose();
                            document.removeEventListener(
                                'paste',
                                onPaste,
                                true
                            );
                            document.removeEventListener('drop', onDrop, true);
                            document.removeEventListener(
                                'dragover',
                                onDragOver,
                                true
                            );
                            term.attachCustomKeyEventHandler(() => true);
                        };
                        // ttyd reconnects normally keep the same term and handler.
                        // If it replaces the instance, bind to the new one too.
                        watcher = setInterval(() => {
                            try {
                                const current = iframeRef.current
                                    ?.contentWindow as TerminalWindow | null;
                                if (
                                    current?.term !== term ||
                                    current?.document !== document
                                ) {
                                    connect();
                                }
                            } catch {
                                connect();
                            }
                        }, 1000);
                        return;
                    }
                } catch {
                    // Same-origin frame navigation can briefly make it unavailable.
                }
                if (attempts < 100) timer = setTimeout(poll, 100);
            };
            poll();
        };
        bridgeRef.current = { connect, enqueue };
        connect();
        return () => {
            disposed = true;
            controller.abort();
            clearTimeout(timer);
            clearInterval(watcher);
            detach();
            dropZone?.removeEventListener('drop', onDrop);
            dropZone?.removeEventListener('dragover', onDragOver);
            bridgeRef.current = null;
        };
    }, [active, terminalUrl, uploadEnabled]);

    const onLoad = useCallback(() => bridgeRef.current?.connect(), []);
    const uploadFiles = useCallback(
        (files: File[]) => bridgeRef.current?.enqueue(files),
        []
    );
    return { iframeRef, dropZoneRef, onLoad, uploadFiles, status, isUploading };
}
