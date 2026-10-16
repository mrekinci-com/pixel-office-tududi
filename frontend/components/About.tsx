import React, { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { getApiPath } from '../config/paths';
import { EditionLink, PIXEL_OFFICE_EDITION } from '../config/edition';

interface AboutProps {
    isDarkMode?: boolean;
}

const LinkSection: React.FC<{
    id: string;
    title: string;
    links: readonly EditionLink[];
}> = ({ id, title, links }) => {
    if (links.length === 0) return null;

    return (
        <section
            aria-labelledby={id}
            className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6"
        >
            <h2
                id={id}
                className="text-lg font-semibold text-gray-900 dark:text-white mb-4 text-center"
            >
                {title}
            </h2>
            <div className="grid grid-cols-2 gap-4">
                {links.map((link) => (
                    <a
                        key={link.url}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center px-4 py-3 bg-white dark:bg-gray-800 border-2 border-gray-800 dark:border-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-300 rounded-lg transition-colors duration-200 font-medium"
                    >
                        <svg
                            aria-hidden="true"
                            className="w-5 h-5 mr-2 shrink-0"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                        >
                            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                        </svg>
                        {link.label}
                    </a>
                ))}
            </div>
        </section>
    );
};

const About: React.FC<AboutProps> = ({ isDarkMode = false }) => {
    const { t } = useTranslation();
    const [version, setVersion] = useState<string | null>(null);
    const githubUrl = `https://github.com/${PIXEL_OFFICE_EDITION.githubUsername}`;
    const linkClass = 'text-blue-600 dark:text-blue-400 hover:underline';

    useEffect(() => {
        const controller = new AbortController();
        fetch(getApiPath('version'), { signal: controller.signal })
            .then((response) => {
                if (!response.ok) throw new Error('Version unavailable');
                return response.json();
            })
            .then((data) => {
                if (
                    !controller.signal.aborted &&
                    typeof data.version === 'string'
                ) {
                    setVersion(data.version);
                }
            })
            .catch(() => {});
        return () => controller.abort();
    }, []);

    return (
        <div className="w-full px-4 pt-4 pb-8">
            <div className="max-w-2xl mx-auto space-y-6">
                <h1
                    className={`text-2xl font-semibold ${isDarkMode ? 'text-gray-100' : 'text-gray-900'}`}
                >
                    {t('about.title', 'Tududi — mrekinci edition')}
                </h1>
                {version && (
                    <p className="text-gray-600 dark:text-gray-400">
                        {t('about.version', 'Version')} {version}
                    </p>
                )}
                <p className="text-gray-700 dark:text-gray-300">
                    {t('about.adaptedBy', {
                        name: PIXEL_OFFICE_EDITION.maintainerName,
                        defaultValue:
                            "This is {{name}}'s customized edition of Tududi; Pixel Office uses this edition.",
                    })}
                </p>
                <div className="flex flex-wrap gap-6">
                    <a
                        href={githubUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={linkClass}
                    >
                        {t('about.maintainerGitHub', 'Maintainer on GitHub')}
                    </a>
                    <a
                        href={`${githubUrl}/pixel-office`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={linkClass}
                    >
                        Pixel Office
                    </a>
                </div>
                <LinkSection
                    id="about-support"
                    title={t('about.supportAndCommunity', 'Support & community')}
                    links={[
                        ...PIXEL_OFFICE_EDITION.supportLinks,
                        ...PIXEL_OFFICE_EDITION.communityLinks,
                    ]}
                />
                <p className="border-t border-gray-200 dark:border-gray-700 pt-6 text-sm text-gray-500 dark:text-gray-400">
                    <Trans
                        i18nKey="about.attribution"
                        defaults="Tududi was originally developed by Chris Veleris (<upstream>github.com/chrisvel/tududi</upstream>), MIT license."
                        components={{
                            upstream: (
                                <a
                                    href="https://github.com/chrisvel/tududi"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className={linkClass}
                                />
                            ),
                        }}
                    />
                </p>
            </div>
        </div>
    );
};

export default About;
