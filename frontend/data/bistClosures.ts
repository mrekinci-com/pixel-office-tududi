// Official full-day closures only; half sessions and unknown years are not inferred.
// borsaistanbul.com/resmi-tatil-gunleri, verified 2026-10-03.
// bist-official-full-day-2021-2026.v1 (2025–2026 subset).
const closuresByYear: Record<string, string[]> = {
    '2025': [
        '01-01',
        '03-29',
        '03-30',
        '03-31',
        '04-01',
        '04-23',
        '05-01',
        '05-19',
        '06-06',
        '06-07',
        '06-08',
        '06-09',
        '07-15',
        '08-30',
        '10-29',
    ],
    '2026': [
        '01-01',
        '03-20',
        '03-21',
        '03-22',
        '04-23',
        '05-01',
        '05-19',
        '05-27',
        '05-28',
        '05-29',
        '05-30',
        '07-15',
        '08-30',
        '10-29',
    ],
};

export const bistClosures = new Set(
    Object.entries(closuresByYear).flatMap(([year, dates]) =>
        dates.map((date) => `${year}-${date}`)
    )
);

export const isBistClosed = (date: string): boolean => bistClosures.has(date);
