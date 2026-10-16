import React, { createContext, useContext, useEffect, useState } from 'react';
import { getApiPath, getBasePath } from '../../config/paths';

export interface TerminalConfig {
    url: string;
    label: string;
    cli: 'claude' | 'codex' | null;
    uploadEnabled: boolean;
}

const TerminalContext = createContext<{
    loading: boolean;
    config: TerminalConfig | null;
}>({ loading: false, config: null });

// Mounted inside the authenticated layout, keyed by account so no config is
// carried across sign-out/sign-in. Failed/disabled responses always hide UI.
export const TerminalProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const [state, setState] = useState<{
        loading: boolean;
        config: TerminalConfig | null;
    }>({ loading: true, config: null });
    useEffect(() => {
        const controller = new AbortController();
        const load = async () => {
            try {
                const response = await fetch(getApiPath('terminal/config'), {
                    credentials: 'include',
                    signal: controller.signal,
                });
                if (!response.ok) throw new Error('Terminal unavailable');
                const value = await response.json();
                const base =
                    value.base_url === '/terminal-proxy/'
                        ? `${getBasePath()}${value.base_url}`
                        : value.base_url;
                // An iframe with clipboard access must stay on this application.
                if (
                    value.enabled !== true ||
                    typeof base !== 'string' ||
                    !base.startsWith('/') ||
                    base.startsWith('//') ||
                    base.includes('\\') ||
                    new URL(base, window.location.origin).origin !==
                        window.location.origin ||
                    !base.endsWith('/terminal-proxy/')
                )
                    throw new Error('Invalid Terminal URL');
                const arg = value.session_arg;
                if (
                    arg !== undefined &&
                    (typeof arg !== 'string' || !/^[a-z0-9]{8,40}$/.test(arg))
                )
                    throw new Error('Invalid Terminal session');
                if (!controller.signal.aborted)
                    setState({
                        loading: false,
                        config: {
                            url: arg
                                ? `${base}?arg=${encodeURIComponent(arg)}`
                                : base,
                            label:
                                typeof value.label === 'string'
                                    ? value.label
                                    : 'Terminal',
                            cli:
                                value.cli === 'claude' || value.cli === 'codex'
                                    ? value.cli
                                    : null,
                            uploadEnabled: value.upload_enabled === true,
                        },
                    });
            } catch {
                if (!controller.signal.aborted)
                    setState({ loading: false, config: null });
            }
        };
        load();
        return () => controller.abort();
    }, []);
    return (
        <TerminalContext.Provider value={state}>
            {children}
        </TerminalContext.Provider>
    );
};

export const useTerminalConfig = () => useContext(TerminalContext);
