# Board document migration and rollback

Shiori keeps the existing board ID, project assignment, owner and sharing permissions. A V2 board stores its pages, elements and stamps in PostgreSQL and exposes a consistent snapshot with an epoch, sequence and content hash.

## Migrate a board

Run the schema migration before starting the new API. On an upgrade, back up PostgreSQL and let legacy editors finish saving before switching the API. The first authorized V2 snapshot request activates an untouched board. Operators can inspect or activate a board explicitly.

```bash
docker compose exec -T server shiori documents inspect "$BOARD_ID"
docker compose exec -T server shiori documents migrate "$BOARD_ID"
```

For an unmigrated board, `inspect` previews the page, element and stamp counts. A `migrationIssue` identifies source data that requires review, such as duplicate IDs. Inspection leaves the source intact.

The last saved board is the starting document. A board without pages gets an initial page. Items without a valid page are assigned to the first page. Image payloads and widget data travel with their objects. The legacy board and operations are archived in the same transaction. The old log has no reliable saved-snapshot watermark, so it is preserved for review. Invalid or ambiguous source data leaves the board in legacy storage for review.

The active board continues to support legacy reads. PostgreSQL fences legacy snapshot and operation writes. An older editing client must reload to use the V2 protocol.

## Review the recovery copy

The migration report identifies the archive epoch, object counts and hash. Export a recovery copy to an access-controlled location. The export can contain board content and user identifiers.

```bash
docker compose exec -T server shiori documents export-legacy "$BOARD_ID" "$ARCHIVE_EPOCH" > "$RECOVERY_FILE"
```

## Roll back a board

Inspect the board and record its current epoch and sequence. The rollback command requires both values and refuses a stale plan. It checkpoints the current V2 document, projects that state into the legacy format and enables the legacy editor. Previously archived operations remain in the recovery archive. The legacy editor opens the projected snapshot and starts a new operation log.

```bash
docker compose exec -T server shiori documents inspect "$BOARD_ID"
docker compose exec -T server shiori documents rollback "$BOARD_ID" "$EPOCH" "$SEQ"
```

Use the current application image for compatibility mode. A board explicitly rolled back stays in legacy mode until an operator runs `documents migrate` again. A fresh V2 epoch fences pending commands created before the transition. The schema migration ledger and prior checkpoints stay available for recovery.

## Verify with two replicas

Use two local API replicas connected to the same disposable PostgreSQL database and Redis instance. Publish the API and PostgreSQL ports on loopback. Run the acceptance test from `server/` after both APIs report readiness.

```bash
SHIORI_CLUSTER_PRIMARY=http://127.0.0.1:44881 \
SHIORI_CLUSTER_SECONDARY=http://127.0.0.1:44882 \
SHIORI_CLUSTER_DATABASE_URL='postgres://postgres:postgres@127.0.0.1:45442/shiori_cluster_test?sslmode=disable' \
go test -race -count=1 -v ./tests -run '^Test(Document|Review)Cluster$'
```

`TestDocumentCluster` checks legacy write fences, submits through both APIs, compares the committed sequence and snapshot hash, and verifies rollback and reactivation. `TestReviewCluster` checks grouped edits and undo across replicas, review and mention visibility, invitation and link roles, and snapshot equality after version restore. Both create synthetic accounts and boards. Set `SHIORI_TEST_DATABASE_URL` to the disposable PostgreSQL URL and run `go test -race -count=1 -v ./internal/document` for the schema-isolated model tests.
