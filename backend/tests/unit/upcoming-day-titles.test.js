const moment = require('moment-timezone');
const {
    generateGroupName,
    groupTasksByDay,
} = require('../../routes/tasks/operations/grouping');

describe('Upcoming day titles', () => {
    const tz = 'Europe/Istanbul';
    const now = moment.tz('2026-10-03 12:00', tz);

    it('uses Turkish titles for Turkish users', () => {
        expect(generateGroupName('2026-10-03', now, tz, 'tr')).toBe('Bugün');
        expect(generateGroupName('2026-10-04', now, tz, 'tr')).toBe('Yarın');
        expect(generateGroupName('2026-10-05', now, tz, 'tr')).toBe(
            'Pazartesi, 5 Ekim'
        );
    });

    it('keeps English titles otherwise and leaves the global locale English', () => {
        expect(generateGroupName('2026-10-05', now, tz, 'en')).toBe(
            'Monday, October 5'
        );
        expect(generateGroupName('2026-10-05', now, tz, undefined)).toBe(
            'Monday, October 5'
        );
        expect(moment.locale()).toBe('en');
    });

    it('names the undated group in Turkish', async () => {
        const groups = await groupTasksByDay(
            [{ id: 1, name: 'x', due_date: null }],
            tz,
            90,
            'due_date:asc',
            'tr'
        );
        expect(Object.keys(groups)).toEqual(['Tarihsiz']);
    });
});
