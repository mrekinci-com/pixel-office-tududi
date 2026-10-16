import { Task } from '../../../entities/Task';
import {
    addDays,
    agendaGroup,
    dueDay,
    formatCivilDate,
    formatAgendaDate,
    monthGrid,
    projectColor,
    readHiddenProjects,
    readView,
    relativeDue,
    savePreference,
    shiftMonth,
    todayInTimezone,
    VIEW_KEY,
    PROJECTS_KEY,
} from '../upcomingDates';

describe('Upcoming civil dates', () => {
    beforeEach(() => localStorage.clear());

    it('starts November 2026 on Monday October 26 and always renders six weeks', () => {
        const days = monthGrid('2026-11-01');
        expect(days).toHaveLength(42);
        expect(days[0]).toBe('2026-10-26');
        expect(days[41]).toBe('2026-12-06');
        expect(monthGrid('2026-02-01')).toHaveLength(42);
        expect(monthGrid('2026-06-01')[0]).toBe('2026-06-01');
        expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
        expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
    });

    it.each([
        ['2026-10-05', 'overdue'],
        ['2026-10-07', 'today'],
        ['2026-10-08', 'tomorrow'],
        ['2026-10-09', 'thisWeek'],
        ['2026-10-12', 'nextWeek'],
        ['2026-10-18', 'nextWeek'],
        ['2026-10-19', 'thisMonth'],
        ['2026-11-01', 'later'],
    ])('groups %s as %s', (day, expected) => {
        expect(agendaGroup(day, '2026-10-07')).toBe(expected);
    });

    it('prioritizes tomorrow, then next week across month/year boundaries', () => {
        expect(agendaGroup('2026-11-02', '2026-11-01')).toBe('tomorrow');
        expect(agendaGroup('2027-01-01', '2026-12-30')).toBe('thisWeek');
        expect(agendaGroup('2027-01-04', '2026-12-30')).toBe('nextWeek');
    });

    it.each([
        ['2026-10-07', 'today', 0],
        ['2026-10-08', 'tomorrow', 1],
        ['2026-10-10', 'daysLeft', 3],
        ['2026-10-05', 'daysOverdue', 2],
    ])('describes %s relative to today', (day, key, count) => {
        expect(relativeDue(day, '2026-10-07')).toEqual({ key, count });
    });

    it('keeps API day values and uses the user timezone for today', () => {
        expect(dueDay({ due_date: '2026-11-20T00:00:00Z' } as Task)).toBe(
            '2026-11-20'
        );
        expect(dueDay({ due_date: '2026-02-30' } as Task)).toBeNull();
        expect(dueDay({ due_date: '' } as Task)).toBeNull();
        expect(
            todayInTimezone(new Date('2026-10-03T22:30:00Z'), 'Europe/Istanbul')
        ).toBe('2026-10-04');
        expect(
            todayInTimezone(
                new Date('2026-10-03T01:00:00Z'),
                'America/Los_Angeles'
            )
        ).toBe('2026-10-02');
        expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    });

    it('uses Turkish month and weekday names', () => {
        expect(formatAgendaDate('2026-11-20', 'tr')).toBe('Cuma, 20 Kasım');
        expect(
            formatCivilDate('2026-10-01', 'tr', {
                month: 'long',
                year: 'numeric',
            })
        ).toBe('Ekim 2026');
        expect(
            formatCivilDate('2026-11-20', 'tr', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
            })
        ).toBe('20 Kasım Cuma');
        expect(formatCivilDate('2026-10-26', 'tr', { weekday: 'long' })).toBe(
            'Pazartesi'
        );
    });

    it('stores valid view/filter preferences and rejects malformed values', () => {
        savePreference(VIEW_KEY, 'agenda');
        savePreference(PROJECTS_KEY, '["1","none"]');
        expect(readView()).toBe('agenda');
        expect(readHiddenProjects()).toEqual(['1', 'none']);
        localStorage.setItem(PROJECTS_KEY, '{}');
        expect(readHiddenProjects()).toEqual([]);
        localStorage.setItem(PROJECTS_KEY, '[');
        expect(readHiddenProjects()).toEqual([]);
    });

    it('continues when storage is unavailable', () => {
        const get = jest
            .spyOn(Storage.prototype, 'getItem')
            .mockImplementation(() => {
                throw new Error('blocked');
            });
        const set = jest
            .spyOn(Storage.prototype, 'setItem')
            .mockImplementation(() => {
                throw new Error('blocked');
            });
        expect(() => savePreference(VIEW_KEY, 'agenda')).not.toThrow();
        expect(readHiddenProjects()).toEqual([]);
        expect(readView()).toBe('calendar');
        get.mockRestore();
        set.mockRestore();
    });

    it('uses stable project colors and honors an existing color', () => {
        expect(projectColor({ id: 1, name: 'A' })).toBe(
            projectColor({ id: 1, name: 'Renamed' })
        );
        expect(projectColor({ uid: 'project-a', name: 'A' })).toBe(
            projectColor({ uid: 'project-a', name: 'A' })
        );
        expect(
            projectColor({ id: 1, name: 'A', color: '#123abc' } as any)
        ).toBe('#123abc');
    });
});
