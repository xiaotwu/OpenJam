# Board review, sharing and versions

These routes live under `/api/v2/boards/{id}` and require a stored session. Board writes and permission changes take the same PostgreSQL room lock as document commands. The responses use private, no-store caching.

## Review

- `/review/threads` lists threads and accepts a new thread. `/review/threads/{id}` reads a thread, with paged comments, and accepts a resolved state. `/review/threads/{id}/replies` creates a reply. Authors can edit their own comment through `/review/threads/{id}/comments/{commentId}` with its previous `updatedAt`.
- An anchor identifies a page, an object on that page, or a point. Threads keep the original page and anchor. An object that moves can still be located. A missing page or object is shown with the original anchor information.
- Viewers read threads. Commenters, editors and owners can write. A thread author, editor or owner can resolve or reopen it. New threads and replies use a request UUID so a retry can return the existing record.
- `/review/people` lists mention recipients with board access. `/review/notifications` lists the current account's mentions, and `/review/notifications/{commentId}/read` marks one read. The panel refreshes persisted state while open. Comment text can be drafted in an open tab while the connection is down.

## Sharing

- `/access` reports the effective role, its source and capabilities. Precedence is owner, explicit member, redeemed link, then a legacy link within its upgrade window. The owner manages sharing through `/sharing`.
- `/sharing/invitations` creates an email-bound invitation for viewing, commenting or editing. `/sharing/invitations/accept` requires the signed-in email to match. Pending invitations can be revoked. Changes to an accepted member use `/sharing/members/{id}`.
- `/sharing/links` creates a board-scoped view or comment link. `/sharing/links/redeem` grants its role to the signed-in account through the link's expiry. Revoking a link removes access that depends on that link. Named invitations and links expire in 1–30 days. Credentials are stored as hashes and appear in the fragment of the copied URL.
- Existing open link settings have a 30-day upgrade window. Owners can close the old link early. The API invalidates active subscriptions when access is reduced, with database checks on reconnect and on reads and writes.

## Versions

- `/versions` lists versions and accepts a name with the current `expectedEpoch` and `expectedSeq`. `/versions/{id}` previews the immutable snapshot. Editors and owners can copy it into a privately owned board using `/versions/{id}/copy`.
- An owner restores through `/versions/{id}/restore` using the current epoch, sequence and a request UUID. One transaction checkpoints the current document, replaces it with the selected snapshot, verifies the hash, advances the epoch and sequence, and records the restore receipt. The same request can be retried through another replica. Existing comment threads, members and links continue to reference the board.
- The editor refetches its snapshot after the epoch changes. Older commands require review, and session undo history starts fresh. The pre-restore checkpoint is available as a restore target.
- Eligible boards get an automatic checkpoint every 50 committed edits. Up to 12 automatic checkpoints of at most 8 MiB each are retained per board. Named versions and restore checkpoints have separate retention.

## Live presentation

An editor or owner can start presenting through `/ws/v2`. A `present_view` message carries `active`, `pageId`, the viewport's center in board coordinates and `scale`. The server sets the user and epoch. Followers explicitly choose a presenter, and their own navigation or a disconnected presentation ends following. Viewport events are ephemeral.
