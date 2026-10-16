import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import TaskPriorityIcon from '../TaskPriorityIcon';

jest.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

describe('TaskPriorityIcon completion confirmation', () => {
    it('asks before completing and completes only on confirm', () => {
        const toggle = jest.fn();
        const parentClick = jest.fn();
        render(
            <div onClick={parentClick}>
                <TaskPriorityIcon
                    priority="high"
                    status="not_started"
                    onToggleCompletion={toggle}
                />
            </div>
        );
        fireEvent.click(screen.getByTestId('task-completion-checkbox'));
        expect(toggle).not.toHaveBeenCalled();
        expect(screen.getByText('Mark as done?')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
        expect(toggle).toHaveBeenCalledTimes(1);
        expect(parentClick).not.toHaveBeenCalled();
        expect(screen.queryByText('Mark as done?')).not.toBeInTheDocument();
    });

    it('cancels without changing the task, also for reopening', () => {
        const toggle = jest.fn();
        render(
            <TaskPriorityIcon
                priority="low"
                status="done"
                onToggleCompletion={toggle}
            />
        );
        fireEvent.click(screen.getByTestId('task-completion-checkbox'));
        expect(screen.getByText('Reopen task?')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('confirm-dialog-cancel'));
        expect(toggle).not.toHaveBeenCalled();
        expect(screen.queryByText('Reopen task?')).not.toBeInTheDocument();
    });

    it('does nothing without a completion handler', () => {
        render(<TaskPriorityIcon priority="low" status="not_started" />);
        fireEvent.click(screen.getByTestId('task-completion-checkbox'));
        expect(screen.queryByText('Mark as done?')).not.toBeInTheDocument();
    });
});
