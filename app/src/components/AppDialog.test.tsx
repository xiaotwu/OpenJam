import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, TextInputDialog } from './AppDialog';

describe('AppDialog', () => {
  it('calls the confirm action from a confirmation dialog', () => {
    const onConfirm = vi.fn();

    render(
      <ConfirmDialog
        isOpen
        title="Delete Project"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('submits trimmed text from the input dialog', () => {
    const onSubmit = vi.fn();

    render(
      <TextInputDialog
        isOpen
        title="Rename"
        label="Project name"
        initialValue="  Old name  "
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />
    );

    const input = screen.getByLabelText('Project name');
    fireEvent.change(input, { target: { value: '  New name  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSubmit).toHaveBeenCalledWith('New name');
  });
});
