import React, { useMemo, useState } from 'react';
import { Note } from '../../entities/Note';
import NoteCard from '../Shared/NoteCard';
import { TFunction } from 'i18next';
import { PlusCircleIcon } from '@heroicons/react/24/outline';
import { Project } from '../../entities/Project';

interface ProjectNotesSectionProps {
    project: Project;
    notes: Note[];
    t: TFunction;
    onCreateNote: () => void;
    onEditNote: (note: Note) => Promise<void>;
    onDeleteNote: (note: Note) => void;
}

type NoteSortOption = 'created_desc' | 'created_asc' | 'updated_desc' | 'title';

const NOTE_SORT_KEY = 'project_notes_sort';
const NOTE_SORT_OPTIONS: NoteSortOption[] = [
    'created_desc',
    'created_asc',
    'updated_desc',
    'title',
];

const readStoredSort = (): NoteSortOption => {
    try {
        const stored = localStorage.getItem(NOTE_SORT_KEY) as NoteSortOption;
        if (NOTE_SORT_OPTIONS.includes(stored)) return stored;
    } catch {
        // Fall back to the default order without persisted state.
    }
    return 'created_desc';
};

const timeOf = (value?: string): number => {
    const time = value ? new Date(value).getTime() : NaN;
    return Number.isNaN(time) ? 0 : time;
};

export const sortNotes = (notes: Note[], sort: NoteSortOption): Note[] => {
    const sorted = [...notes];
    switch (sort) {
        case 'created_asc':
            return sorted.sort(
                (a, b) => timeOf(a.created_at) - timeOf(b.created_at)
            );
        case 'updated_desc':
            return sorted.sort(
                (a, b) =>
                    timeOf(b.updated_at || b.created_at) -
                    timeOf(a.updated_at || a.created_at)
            );
        case 'title':
            return sorted.sort((a, b) =>
                (a.title || '').localeCompare(b.title || '', undefined, {
                    numeric: true,
                    sensitivity: 'base',
                })
            );
        default:
            return sorted.sort(
                (a, b) => timeOf(b.created_at) - timeOf(a.created_at)
            );
    }
};

const ProjectNotesSection: React.FC<ProjectNotesSectionProps> = ({
    project,
    notes,
    t,
    onCreateNote,
    onEditNote,
    onDeleteNote,
}) => {
    const [sort, setSort] = useState<NoteSortOption>(readStoredSort);
    const sortedNotes = useMemo(() => sortNotes(notes, sort), [notes, sort]);

    const handleSortChange = (value: NoteSortOption) => {
        setSort(value);
        try {
            localStorage.setItem(NOTE_SORT_KEY, value);
        } catch {
            // Keep sorting usable without persisting the choice.
        }
    };

    const sortLabels: Record<NoteSortOption, string> = {
        created_desc: t('notes.sort.createdDesc', 'Newest first'),
        created_asc: t('notes.sort.createdAsc', 'Oldest first'),
        updated_desc: t('notes.sort.updatedDesc', 'Last edited'),
        title: t('notes.sort.title', 'Title (A-Z)'),
    };

    return (
        <div className="transition-all duration-300 ease-in-out">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <button
                    type="button"
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 transition-colors"
                    onClick={() => {
                        if (!project?.id || !project.name) return;
                        onCreateNote();
                    }}
                >
                    <PlusCircleIcon className="h-5 w-5" />
                    {t('modals.noteCreation', 'Create New Note')}
                </button>
                {notes.length > 1 && (
                    <label className="inline-flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <span>{t('tasks.sortBy', 'Sort by')}</span>
                        <select
                            value={sort}
                            onChange={(e) =>
                                handleSortChange(
                                    e.target.value as NoteSortOption
                                )
                            }
                            className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                        >
                            {NOTE_SORT_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                    {sortLabels[option]}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
            </div>

            {notes.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {sortedNotes.map((note) => (
                        <NoteCard
                            key={note.uid}
                            note={note}
                            onEdit={onEditNote}
                            onDelete={onDeleteNote}
                            showActions={true}
                            showProject={false}
                        />
                    ))}
                </div>
            ) : (
                <div className="text-gray-500 dark:text-gray-400">
                    <p>{t('project.noNotes', 'No notes for this project.')}</p>
                </div>
            )}
        </div>
    );
};

export default ProjectNotesSection;
