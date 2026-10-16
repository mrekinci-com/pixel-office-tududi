import React from 'react';
import { render, screen, cleanup, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import About from '../About';
import en from '../../../public/locales/en/translation.json';
import tr from '../../../public/locales/tr/translation.json';
import { PIXEL_OFFICE_EDITION } from '../../config/edition';

const resources = {
    en: { translation: en },
    tr: { translation: tr },
};
const originalFetch = global.fetch;

async function renderAbout(lng = 'tr', isDarkMode = false) {
    const i18n = createInstance();
    await i18n
        .use(initReactI18next)
        .init({ lng, resources, interpolation: { escapeValue: false } });
    document.documentElement.classList.toggle('dark', isDarkMode);
    return render(
        <I18nextProvider i18n={i18n}>
            <About isDarkMode={isDarkMode} />
        </I18nextProvider>
    );
}

beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: '0.87-po.5' }),
    });
});

afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    global.fetch = originalFetch;
    document.documentElement.classList.remove('dark');
});

test.each([
    ['tr', false],
    ['tr', true],
    ['en', false],
    ['en', true],
] as const)(
    'About shows the maintainer, attribution and own link boxes in %s (dark: %s)',
    async (lng, isDarkMode) => {
        const translation = resources[lng].translation.about;
        const { container } = await renderAbout(lng, isDarkMode);
        expect(
            screen.getByRole('heading', { level: 1, name: translation.title })
        ).toBeInTheDocument();
        expect(
            screen.getByText(
                translation.adaptedBy.replace('{{name}}', 'mrekinci')
            )
        ).toBeInTheDocument();
        expect(await screen.findByText(/0\.87-po\.5/)).toBeInTheDocument();
        expect(
            screen.getByRole('link', { name: translation.maintainerGitHub })
        ).toHaveAttribute('href', 'https://github.com/mrekinci-com');
        expect(
            screen.getByRole('link', { name: 'Pixel Office' })
        ).toHaveAttribute(
            'href',
            'https://github.com/mrekinci-com/pixel-office'
        );

        const box = screen.getByRole('region', {
            name: translation.supportAndCommunity,
        });
        expect(within(box).getAllByRole('link')).toHaveLength(2);
        expect(
            within(box).getByRole('link', { name: 'GitHub Sponsors' })
        ).toHaveAttribute('href', 'https://github.com/sponsors/mrekinci-com');
        expect(
            within(box).getByRole('link', { name: 'GitHub' })
        ).toHaveAttribute('href', 'https://github.com/mrekinci-com');
        expect(box).toHaveClass('bg-white', 'dark:bg-gray-800');
        expect(box.querySelector('.grid')).toHaveClass('grid-cols-2', 'gap-4');
        expect(
            screen.queryByRole('region', { name: translation.community })
        ).toBeNull();

        const links = screen.getAllByRole('link');
        expect(links).toHaveLength(5);
        for (const link of links) {
            expect(link).toHaveAttribute('target', '_blank');
            expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        }
        expect(
            screen.getByRole('link', { name: 'github.com/chrisvel/tududi' })
        ).toHaveAttribute('href', 'https://github.com/chrisvel/tududi');
        expect(container.textContent).toMatch(/Chris Veleris.*MIT/);
        expect(container.textContent).not.toMatch(
            /Patreon|PayPal|Reddit|Discord|Buy Me a Coffee|Official Website|Resmî site/i
        );
    }
);

test.each([
    [true, false],
    [false, true],
    [true, true],
])(
    'one combined box shows whatever links remain (support empty: %s, community empty: %s)',
    async (hideSupport, hideCommunity) => {
        if (hideSupport) {
            jest.replaceProperty(PIXEL_OFFICE_EDITION, 'supportLinks', []);
        }
        if (hideCommunity) {
            jest.replaceProperty(PIXEL_OFFICE_EDITION, 'communityLinks', []);
        }
        await renderAbout();
        await screen.findByText(/0\.87-po\.5/);
        expect(
            screen.queryByRole('region', { name: 'Destek ve topluluk' }) !==
                null
        ).toBe(!(hideSupport && hideCommunity));
        expect(screen.getAllByRole('link')).toHaveLength(
            5 - Number(hideSupport) - Number(hideCommunity)
        );
    }
);

test('unavailable version does not hide the attribution or maintainer', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    await renderAbout();
    expect(
        screen.getByText(
            /tarafından kendi kullanımı için özelleştirilmiş Tududi sürümüdür/
        )
    ).toHaveTextContent('mrekinci');
    expect(
        screen.getByRole('link', { name: 'github.com/chrisvel/tududi' })
    ).toBeInTheDocument();
    expect(
        screen.getByRole('link', { name: 'GitHub Sponsors' })
    ).toHaveAttribute('href', 'https://github.com/sponsors/mrekinci-com');
});
