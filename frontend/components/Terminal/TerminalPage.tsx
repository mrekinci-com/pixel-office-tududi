import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTerminalConfig } from './TerminalConfig';
import { useTerminalBridge } from './TerminalBridge';
import TerminalUploadControl from './TerminalUploadControl';

const TerminalPage: React.FC = () => {
    const { t } = useTranslation();
    const { loading, config } = useTerminalConfig();
    const bridge = useTerminalBridge(
        !!config,
        config?.url || '',
        config?.uploadEnabled || false
    );
    if (!config)
        return (
            <div className="p-8 text-gray-600 dark:text-gray-300" role="status">
                {loading
                    ? t('terminal.loading', 'Loading Terminal…')
                    : t(
                          'terminal.disabled',
                          'Terminal is not enabled for this account.'
                      )}
            </div>
        );
    return (
        <section
            ref={bridge.dropZoneRef}
            className="flex flex-col w-full px-2 sm:px-4 h-[calc(100dvh-6rem)]"
        >
            <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-t-lg">
                <h1 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {t('sidebar.terminal', 'Terminal')}
                    {config.label !== 'Terminal' && (
                        <span className="ml-2 text-gray-500">
                            · {config.label}
                        </span>
                    )}
                </h1>
                {config.cli && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                        {config.cli === 'claude'
                            ? t(
                                  'terminal.claudeHint',
                                  'Claude Code on the host'
                              )
                            : t('terminal.codexHint', 'Codex on the host')}
                    </span>
                )}
                <TerminalUploadControl
                    enabled={config.uploadEnabled}
                    isUploading={bridge.isUploading}
                    status={bridge.status}
                    uploadFiles={bridge.uploadFiles}
                />
                <a
                    href={config.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto text-xs text-blue-600 dark:text-blue-400 hover:underline"
                >
                    {t('terminal.openInNewWindow', 'Open in new window')}
                </a>
            </div>
            <p className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400">
                {t(
                    'terminal.shortcuts',
                    'Ctrl/Cmd+V: paste · Ctrl/Cmd+C: copy selection (interrupt when empty)'
                )}
                {config.uploadEnabled && (
                    <>
                        {' '}
                        ·{' '}
                        {t(
                            'terminal.imagesHint',
                            'Paste, drop or select images (up to 15 MB each).'
                        )}
                    </>
                )}
            </p>
            <iframe
                ref={bridge.iframeRef}
                onLoad={bridge.onLoad}
                referrerPolicy="no-referrer"
                title={t('sidebar.terminal', 'Terminal')}
                src={config.url}
                className="flex-1 min-h-0 w-full bg-black border border-gray-200 dark:border-gray-800 rounded-b-lg"
                allow="clipboard-read; clipboard-write"
            />
        </section>
    );
};

export default TerminalPage;
