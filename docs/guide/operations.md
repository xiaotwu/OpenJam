# OpenJam operations

Run these commands from the checkout that contains the deployment's Compose file. The operations script uses Python 3.9 or later. The backup procedure covers the default Compose PostgreSQL, Redis and SeaweedFS layout. The diagnostic commands also work with configured external dependencies.

```bash
oj_project=openjam
oj_env="$PWD/.env"
oj_url=http://127.0.0.1:8080
oj_compose=(docker compose --project-name "$oj_project" --env-file "$oj_env")
oj_ops=(python3 scripts/openjam-ops.py --project "$oj_project" --env-file "$oj_env")
```

For a pilot, use a named deployment, pin the image in `OPENJAM_IMAGE`, and follow the [Docker deployment guide](./docker.md). Keep a separate, access controlled copy of the environment file, Compose files, proxy configuration, TLS material, and the application image reference or locally retained image. These are needed when rebuilding the deployment.

## Quick check and self-check

```bash
python3 scripts/openjam-ops.py quick-check "$oj_url"
"${oj_ops[@]}" self-check
"${oj_ops[@]}" self-check --assets --timeout 5m
```

The quick check verifies the HTTP responses from `/livez`, `/startupz`, `/readyz` and `/health`. The storage flag in `/health` reflects initialization at API startup. The self-check verifies that server and worker containers use the same image and tests each running server's PostgreSQL connection, migration version, Redis and current S3 read access. Both commands return a nonzero exit status on a failed check.

`--assets` checks byte counts and SHA-256 for every registered private image linked from a file or project snapshot. Run it during a maintenance window or before exposing a restore so the image inventory stays fixed. Allow enough time to read the images. For a service started outside Compose, run `./openjam-server doctor --assets --timeout 5m` with the same environment as the API. These commands use no AI service.

A full smoke check also uses a signed-in account to open a project, read a named version and download a private image. Use a permitted account and an account without the grant. Queue a small Board ZIP export and confirm that the worker finishes it and that the owner can download it.

## Create an instance backup

The backup contains a PostgreSQL custom dump, a cold copy of the SeaweedFS data volume and a manifest with SHA-256 checksums. Together they capture accounts, session records, project and file data, history, grants, attachments and durable job records at the backup time. Redis is rebuilt from empty. Keep instance backups in encrypted storage with access restricted to deployment operators. The database contains sensitive account data and sessions that can still be valid after restore.

1. Check space with `df -h` at the backup destination and estimate room for both the database dump and the full storage volume. Choose a new directory on a protected filesystem.
2. Run the self-check with `--assets`. Have users finish saving and put ingress into maintenance. Stop every API and worker for this database and bucket, then stop SeaweedFS. Keep PostgreSQL running. Quiesce any other writers using these stores.
3. Run the backup and verify its files. A backup is usable once the final manifest exists and verification passes.

```bash
oj_backup=/secure/backups/openjam-before-upgrade
"${oj_compose[@]}" stop --timeout 30 server worker
"${oj_compose[@]}" stop --timeout 30 seaweedfs
"${oj_ops[@]}" backup "$oj_backup"
python3 scripts/openjam-ops.py verify-backup "$oj_backup"
```

Resume with `"${oj_compose[@]}" up --no-build --wait` if the maintenance window ends here. Keep the previous image and its deployment settings with the backup. For managed PostgreSQL, MinIO or another external S3 provider, use the provider's database and object backup procedures during the same write freeze. Restore both stores to one recovery point and rehearse that procedure with the chosen provider.

## Upgrade a deployment

1. Keep the Compose project name and store configuration. Record the current application image ID, the schema version from `doctor` when available, and a small sample of content, named versions, attachments and grants.
2. Build or load the candidate image. Make and verify the pre-upgrade backup with the previous image settings still available.
3. Set `OPENJAM_IMAGE` to the candidate image in the deployment environment. Start the stores and run the explicit migration before the new server or worker accepts traffic.

```bash
"${oj_compose[@]}" up --no-build --wait postgres redis seaweedfs
"${oj_compose[@]}" run --rm --no-deps migrate
"${oj_compose[@]}" up --no-build --wait
"${oj_ops[@]}" self-check --assets --timeout 5m
python3 scripts/openjam-ops.py quick-check "$oj_url"
```

4. Open the recorded projects with the same accounts and verify the sample. Confirm that saved edits, history, attachments, allow and deny cases and a new worker export match expectations before reopening ingress. See [Board document migration and rollback](./document-migration.md) if some boards still use the legacy document format.

The binary requires its matching database schema. For rollback after a committed upgrade, restore the pre-upgrade backup into fresh volumes and start the previous image against that restored copy. Verify it before moving ingress. Changes saved after the backup are outside that recovery point. Reconcile any later data or access changes as part of cutover.

## Restore an instance

Prepare a fresh deployment with a different Compose project name and loopback port. Use the PostgreSQL major version, SeaweedFS image and bucket recorded in `manifest.json`. Use the application image that matches the backup schema for the first boot. Restore the deployment secrets from their protected copy. Keep the recovery deployment private until you finish verification.

In a fresh shell, set the variables from the start of this guide for the destination, then run the following commands. `create` leaves SeaweedFS stopped so the archive can be copied into its new volume.

```bash
python3 scripts/openjam-ops.py verify-backup "$oj_backup"
"${oj_compose[@]}" up --no-build --wait postgres redis
"${oj_compose[@]}" create --no-build seaweedfs
"${oj_ops[@]}" restore "$oj_backup"
"${oj_compose[@]}" up --no-build --wait seaweedfs
"${oj_compose[@]}" run --rm --no-deps server doctor --assets --timeout 5m
"${oj_compose[@]}" up --no-build --wait
python3 scripts/openjam-ops.py quick-check "$oj_url"
"${oj_ops[@]}" self-check --assets --timeout 5m
```

For recovery to an older image that predates `doctor`, use the HTTP and signed-in smoke checks after startup. The restore command checks for empty PostgreSQL and Redis databases and a SeaweedFS volume without files before copying data. It restores PostgreSQL in a single transaction. If an interruption leaves either destination store populated, keep the destination offline and start the next attempt with fresh stores.

Verify a personal and a Team project, open historical file versions and project snapshots, and compare a private image with the original. Use at least one permitted and one denied account. Sign in again and run a new export. Reapply membership changes, sharing revocations and session invalidations made after the backup before exposing the recovered instance.

## Troubleshoot

| Symptom | Check |
|---|---|
| Quick check reports `/readyz` unavailable | Run `docker compose ps --all` and check the selected deployment's PostgreSQL health and API logs. A draining server intentionally returns HTTP 503. |
| Self-check reports different installed and required schemas | Confirm the selected image and database. For an upgrade, follow the backup and migration sequence. For rollback, use the matching backup and previous image. |
| Storage initialization fails or the image audit fails | Verify the configured S3 endpoint, bucket, TLS and credentials. An image ID reported by the audit identifies the registered object whose bytes could not be read or verified. Verify the backup and restore the matching object data before reopening ingress. |
| A job stays queued | Check the worker's image, logs and database connection. A running worker may wait for an existing lease to expire before resuming a job. Use a small Board ZIP export to verify progress. |
| Collaboration reconnects repeatedly | Check the reverse proxy's WebSocket forwarding for `/ws` and `/ws/v2`, the HTTPS origin in `CORS_ORIGINS`, and Redis connectivity. Correlate an API failure using its `X-Request-ID`. |
| Restore reports a checksum or target state error | Verify the backup without Docker, then confirm the destination project name and that its stores are empty. Keep the source backup available for a retry. |

Use `"${oj_compose[@]}" logs --tail 100 server worker migrate postgres seaweedfs` for bounded diagnostics. Remove tokens, credentials, and private URLs before sharing logs.
