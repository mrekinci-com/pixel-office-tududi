import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useTerminalBridge } from './TerminalBridge';
import TerminalUploadControl from './TerminalUploadControl';

interface TerminalPanelProps {
    baseUrl: string | null;
    label?: string;
    isOpen: boolean;
    uploadEnabled?: boolean;
    onClose: () => void;
    children: React.ReactNode;
}

const WIDTH_KEY = 'terminal_width';

const TerminalPanel: React.FC<TerminalPanelProps> = ({
    baseUrl,
    label = 'Terminal',
    isOpen,
    uploadEnabled = false,
    onClose,
    children,
}) => {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [width, setWidth] = useState(() => {
        try {
            const stored = localStorage.getItem(WIDTH_KEY);
            const value = stored === null ? 50 : Number(stored);
            return Number.isFinite(value)
                ? Math.min(70, Math.max(30, value))
                : 50;
        } catch {
            return 50;
        }
    });
    const panelVisible = isOpen && !!baseUrl;
    const terminalUrl = panelVisible ? baseUrl || '' : '';
    const title = label === 'Terminal' ? 'Terminal' : `Terminal · ${label}`;
    const bridge = useTerminalBridge(panelVisible, terminalUrl, uploadEnabled);

    const changeWidth = (value: number) => {
        const next = Math.min(70, Math.max(30, value));
        setWidth(next);
        try {
            localStorage.setItem(WIDTH_KEY, String(next));
        } catch {
            // Keep resizing usable when browser storage is unavailable.
        }
    };

    return (
        <div
            ref={containerRef}
            className={
                panelVisible
                    ? 'w-full flex flex-col md:flex-row items-start'
                    : 'w-full'
            }
            style={
                { '--terminal-panel-width': `${width}%` } as React.CSSProperties
            }
        >
            <div className="w-full min-w-0 order-2 md:order-1 md:flex-1">
                {children}
            </div>
            {panelVisible && (
                <>
                    <div
                        role="separator"
                        tabIndex={0}
                        aria-label={t(
                            'terminal.resize',
                            'Resize Terminal panel'
                        )}
                        aria-orientation="vertical"
                        aria-valuemin={30}
                        aria-valuemax={70}
                        aria-valuenow={Math.round(width)}
                        className="hidden md:block order-2 w-2 flex-shrink-0 self-stretch cursor-col-resize touch-none bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 focus:bg-blue-400 focus:outline-none"
                        onPointerDown={(event) => {
                            if (event.button !== 0) return;
                            event.preventDefault();
                            event.currentTarget.setPointerCapture(
                                event.pointerId
                            );
                            setIsDragging(true);
                        }}
                        onPointerMove={(event) => {
                            if (!isDragging) return;
                            const bounds =
                                containerRef.current?.getBoundingClientRect();
                            if (!bounds || bounds.width === 0) return;
                            changeWidth(
                                ((bounds.right - event.clientX) /
                                    bounds.width) *
                                    100
                            );
                        }}
                        onPointerUp={() => setIsDragging(false)}
                        onPointerCancel={() => setIsDragging(false)}
                        onLostPointerCapture={() => setIsDragging(false)}
                        onKeyDown={(event) => {
                            let next = width;
                            if (event.key === 'ArrowLeft') next += 2;
                            else if (event.key === 'ArrowRight') next -= 2;
                            else if (event.key === 'Home') next = 30;
                            else if (event.key === 'End') next = 70;
                            else return;
                            event.preventDefault();
                            changeWidth(next);
                        }}
                    />
                    <aside
                        ref={bridge.dropZoneRef}
                        aria-label={title}
                        className="order-1 md:order-3 w-full md:w-[var(--terminal-panel-width)] md:flex-shrink-0 md:sticky md:top-0 h-[calc(100dvh-5rem)] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700 bg-gray-950 mb-4 md:mb-0"
                    >
                        <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                {title}
                            </span>
                            <TerminalUploadControl
                                enabled={uploadEnabled}
                                isUploading={bridge.isUploading}
                                status={bridge.status}
                                uploadFiles={bridge.uploadFiles}
                            />
                            <a
                                href={terminalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            >
                                {t(
                                    'terminal.openInNewWindow',
                                    'Open in new window'
                                )}
                            </a>
                            <button
                                type="button"
                                onClick={() => {
                                    setIsDragging(false);
                                    onClose();
                                }}
                                aria-label={t(
                                    'terminal.close',
                                    'Close Terminal panel'
                                )}
                                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                            >
                                <XMarkIcon className="h-4 w-4" />
                            </button>
                        </div>
                        <iframe
                            ref={bridge.iframeRef}
                            onLoad={bridge.onLoad}
                            referrerPolicy="no-referrer"
                            src={terminalUrl}
                            title={title}
                            allow="clipboard-read; clipboard-write"
                            className="w-full flex-1 min-h-0 border-0"
                            style={
                                isDragging
                                    ? { pointerEvents: 'none' }
                                    : undefined
                            }
                        />
                    </aside>
                </>
            )}
        </div>
    );
};

export default TerminalPanel;
