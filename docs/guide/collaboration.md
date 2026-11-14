# Real-Time Collaboration

Boards, Docs, Sheets, and Slides share a versioned command protocol. Access follows current file grants and Team and Project roles. A browser can show other people’s presence while those people have access to the file.

## Saving and sync

1. The browser loads a snapshot and subscribes to `/ws/v2` with its session. The snapshot identifies the current document epoch and committed sequence.
2. Edits enter the browser’s local queue and are submitted as commands. The server checks access and writes each accepted command and its receipt before acknowledging it.
3. A socket message announces a new committed sequence. Browsers read the change feed to get the edits they missed. If a notification is delayed or lost, polling the feed still delivers the edits.

The **Saved** indicator means the server has confirmed the edit. If a connection drops, the open editor can keep eligible edits on the device and submit them after reconnection. Reopening a file requires a fresh authenticated snapshot. The server rechecks permission and the current document epoch before accepting queued writes.

## Concurrent edits and versions

Independent edits can be merged. If two people change the same protected value, such as the text of a Doc block or a spreadsheet cell, the editor shows the conflict and keeps the queued edit for review. You can download a draft or discard the conflicting edit and work from the current content.

Use the file’s history to save a named version. Restoring a version starts a new document epoch. An open editor reloads the restored state, and edits queued against the previous epoch require review.

The [API reference](../reference/api.md#document-sync) identifies the current HTTP endpoints. The [board sync contract](https://github.com/xiaotwu/Shiori/blob/main/contracts/board-sync.md) covers command shapes, receipts, and queue limits.
