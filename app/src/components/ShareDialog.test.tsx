import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShareDialog from './ShareDialog';
import type { RoomMember } from '../lib/api';

const members: RoomMember[] = [
  {
    userId: 'user-2',
    email: 'lee@example.com',
    displayName: 'Lee',
    avatarColor: '#3B82F6',
    permission: 'edit',
    createdAt: '2026-04-28T00:00:00Z',
    updatedAt: '2026-04-28T00:00:00Z',
  },
];

function renderShareDialog(overrides: Partial<ComponentProps<typeof ShareDialog>> = {}) {
  return render(
    <ShareDialog
      isOpen
      onClose={vi.fn()}
      boardName="Roadmap"
      shareLink="http://localhost:5173/board/roadmap"
      linkPermission="restricted"
      members={members}
      onChangeLinkPermission={vi.fn()}
      onInvite={vi.fn()}
      onRemoveMember={vi.fn()}
      onCopyLink={vi.fn()}
      {...overrides}
    />
  );
}

describe('ShareDialog', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('shows current members and copies the board link', async () => {
    const onCopyLink = vi.fn();
    renderShareDialog({ onCopyLink });

    expect(screen.getByText('Lee')).not.toBeNull();
    expect(screen.getByDisplayValue('http://localhost:5173/board/roadmap')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://localhost:5173/board/roadmap');
      expect(onCopyLink).toHaveBeenCalledTimes(1);
    });
  });

  it('submits invites and member removal actions', async () => {
    const onInvite = vi.fn().mockResolvedValue(undefined);
    const onRemoveMember = vi.fn().mockResolvedValue(undefined);
    renderShareDialog({ onInvite, onRemoveMember });

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ana@example.com' } });
    fireEvent.change(screen.getByLabelText('Invite permission'), { target: { value: 'view' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));

    await waitFor(() => {
      expect(onInvite).toHaveBeenCalledWith('ana@example.com', 'view');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Lee' }));

    await waitFor(() => {
      expect(onRemoveMember).toHaveBeenCalledWith('user-2');
    });
  });

  it('surfaces API errors inline and updates link permission', () => {
    const onChangeLinkPermission = vi.fn();
    renderShareDialog({
      error: 'Only the board owner can change sharing',
      onChangeLinkPermission,
    });

    expect(screen.getByRole('alert').textContent).toContain('Only the board owner can change sharing');

    fireEvent.change(screen.getByLabelText('Link permission'), { target: { value: 'anyone-edit' } });

    expect(onChangeLinkPermission).toHaveBeenCalledWith('anyone-edit');
  });
});
