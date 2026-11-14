# Board document sync protocol

Version 2 uses the existing session and board access rules. The board ID comes from the request path or WebSocket subscription. The server derives the actor from the session.

## Read and catch up

- `GET /api/v2/boards/{id}/snapshot` returns `protocolVersion`, `boardId`, `epoch`, `seq`, `hash`, `permission`, `updatedAt`, and `document`. The document contains `name`, `defaultPageId`, and ordered `pages`, `elements`, and `stamps` arrays.
- `GET /api/v2/boards/{id}/changes?epoch=1&afterSeq=12&limit=50` returns `boardId`, `epoch`, `headSeq`, `floorSeq`, `permission`, `changes`, and `hasMore`. Each change has `seq`, `epoch`, `clientId`, `commandId`, and canonical `operations`. New changes include the authenticated `actorId`. Apply changes in sequence. Fetch a snapshot on a gap or on `RESYNC_REQUIRED`.
- A change's operations use `kind` values `upsert`, `delete`, and `rename`. Upserts and deletes carry `collection` and `id`. An upsert carries the complete normalized `value` and a logical array `position` when applicable. A rename carries the new name in `value`. A change may set `defaultPageId` when the default page is deleted.

## Submit and confirm

`POST /api/v2/boards/{id}/commands` accepts this envelope.

```json
{
  "protocolVersion": 2,
  "epoch": 1,
  "baseSeq": 12,
  "clientId": "4f6780f4-7c0d-4b6e-b678-50794ae5bb09",
  "commandId": "279b5147-27e5-463e-a99d-693fa1b9a2cc",
  "operations": [
    {
      "kind": "patch",
      "collection": "elements",
      "id": "sticky-23",
      "fields": {"text": "Review the design", "x": 96, "y": 80},
      "expected": {"text": "Review"}
    }
  ]
}
```

- `add` carries `collection`, `id`, and complete `value`. Optional `position` controls page insertion order.
- `patch` carries `collection`, `id`, changed `fields`, optional `unset` keys, and any applicable `expected` fields. Text, page names, and widget data compare against their prior values. Expected null denotes a missing or null field. Independent scalar edits merge. Moves include both coordinates and apply in commit order.
- `delete` carries `collection` and `id`. Optional `expected` compares the complete entity before removing it. A deleted ID stays tombstoned. Empty pages may be deleted while at least one page remains.
- `restore` carries the original `id` and a complete `value` for the optimistic projection. PostgreSQL restores the canonical tombstoned object, page or stamp. The deleting editor and client must match. A page restore can set its logical `position`.
- `reorder` moves a page to a final zero-based `position`. It requires `expected.order` with all page IDs in their previous order. `setDefaultPage` takes the target page ID in `value` and the previous one in `expected.defaultPageId`.
- `rename` carries a string in `value`, with the previous name in `expected.name`.
- `vote` targets a poll or dot-voting element. Its `value.action` is `poll-cast`, `dot-add`, `dot-remove`, or `dot-clear`. The server derives the voter from the authenticated account, enforces one ballot per poll and the per-user dot allowance, and accepts dot coordinates from 0 through 100. Widget configuration edits preserve the stored ballots.

A command can contain up to 256 operations. The final transaction checks that live connector anchors, frames and their children, and grouped objects stay on the same page. Related objects can move together in one command. A command may include `dependsOn` for undo or redo. The dependency must be a committed receipt for the same actor, client, board and epoch.

The response contains `boardId`, `epoch`, `seq`, `clientId`, `commandId`, `replayed`, and the canonical `change` when available. The sequence applies to the whole batch. A retry reuses the exact envelope. The server rejects a reused ID with different contents. The durable change and receipt commit with the document update before the API acknowledges it.

## WebSocket

Connect to `/ws/v2` with the same session. Send `subscribe` with `{boardId, epoch, afterSeq}`. The server registers the subscriber and replies with `subscribed`, which includes the committed high-water mark and presence. The browser catches up through the paged HTTP feed. A `document_changed` message announces a newer committed sequence and triggers another catch-up. Polling the feed covers a lost or delayed wake-up, including during Redis downtime.

The browser submits commands over HTTP and connects to the same-origin WebSocket with its session cookie. Other clients can submit the same command envelope as a `commit` message on the subscribed socket and receive an `ack`. Both transports use the same receipt. Cursor messages and `presence_state` are transient. The latter carries `{users: [...]}` with one presence record per account.

## Errors and offline replay

Errors include `code` and `error`. The actionable codes include `ACCESS_DENIED`, `LEGACY_MODE`, `MIGRATION_BLOCKED`, `STALE_EPOCH`, `RESYNC_REQUIRED`, `CONFLICT`, `IDEMPOTENCY_CONFLICT`, and `INVALID_COMMAND`. Conflicts can include the resource and field values needed to review a queued edit.

The editor persists pending commands in IndexedDB, scoped to the signed-in account and board, before reporting that edits are saved on the device. The queue holds up to 32 MiB or 5,000 commands per board, 128 MiB per account, and 256 MiB per browser origin, measured in UTF-8 bytes of the command envelopes. Each command may use up to 25 MiB. If IndexedDB or a size limit prevents a write, the editor surfaces the unsaved edit and can include it in a draft download while the tab remains open. Pending durable entries are never evicted for space. The already-open editor can keep editing when it loses connectivity. A reopened editor fetches an authenticated snapshot before rendering or replaying.

The browser rechecks the epoch and board permission, catches up through the HTTP feed, and replays the exact envelopes in creation order. It removes an entry only after it applies a matching change or verifies a matching commit receipt covered by the confirmed document. Feed confirmation includes the authenticated actor ID. A lost or timed-out response keeps the envelope queued for an idempotent retry. Browser HTTP requests time out after 12 seconds. Polling continues with jitter at roughly two seconds in a visible tab, four seconds with a live socket, and ten seconds in the background. Consecutive request failures back off.

Commands over seven days old, commands from a previous epoch, and commands outside the retained replay window require review. The open editor closes its document projection after seven days without authenticated access confirmation and preserves pending commands for review after reauthentication. An expired session also hides the board and preserves the account's pending commands. Explicit board revocation or deletion clears that board's queue. Confirmed sign-out clears the signed-out account's queue. Legacy editing is selected only when the server reports compatibility mode. If a board returns to legacy mode with V2 drafts, the editor first offers to export or discard them.

## Editor behavior

- Page selection belongs to the current tab. A V2 page copy and a confirmed page deletion submit the page, objects and stamps in one batch within protocol limits. Deleting objects before the page also lets undo restore the page before its contents.
- Text commits on blur or the Save shortcut. Text, names, and widget changes compare against their previous values. Geometry updates locally during a gesture and submits as a batch on completion.
- The current editor session tracks bounded undo and redo history for document commands. Inverse patches compare the fields the original command changed, and deletion guards compare the full object. A new epoch clears session history. Voting uses its own ballot controls.
- The sync indicator distinguishes writes in progress on the device from commands awaiting server confirmation. The conflict notice displays the current and queued field values when available. Users can download a draft and discard the identified edit. Later queued commands are still checked against the current board.
