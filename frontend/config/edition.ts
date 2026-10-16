export interface EditionLink {
    label: string;
    url: string;
}

const githubUsername = 'mrekinci-com';

export const PIXEL_OFFICE_EDITION = {
    maintainerName: 'mrekinci',
    githubUsername,
    supportLinks: [
        {
            label: 'GitHub Sponsors',
            url: `https://github.com/sponsors/${githubUsername}`,
        },
    ] as readonly EditionLink[],
    communityLinks: [
        { label: 'GitHub', url: `https://github.com/${githubUsername}` },
    ] as readonly EditionLink[],
} as const;
