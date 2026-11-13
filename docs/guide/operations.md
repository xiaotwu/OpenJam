# Shiori operations

Run these commands from the checkout that contains the deployment's Compose file. The operations script uses Python 3.9 or later. The backup procedure covers the default Compose PostgreSQL, Redis and SeaweedFS layout. The diagnostic commands also work with configured external dependencies.

```bash
shiori_project=shiori
shiori_env="$PWD/.env"
shiori_url=http://127.0.0.1:8080
shiori_compose=(docker compose --project-name "$shiori_project" --env-file "$shiori_env")
shiori_ops=(python3 scripts/shiori-ops.py --project "$shiori_project" --env-file "$shiori_env")
```

For a pilot, use a named deployment, pin the image in `SHIORI_IMAGE`, and follow the [Docker deployment guide](./docker.md). Keep a separate, access controlled copy of the environment file, Compose files, proxy configuration, TLS material, and the application image reference or locally retained image. These are needed when rebuilding the deployment.

Use the [pilot acceptance checklist](./pilot-acceptance.md) for the ordered XW-151 ingress and XW-152 recovery gates on the pilot host.

## Quick check and self-check

```bash
python3 scripts/shiori-ops.py quick-check "$shiori_url"
"${shiori_ops[@]}" self-check
"${shiori_ops[@]}" self-check --assets --timeout 5m
```

The quick check verifies the HTTP responses from `/livez`, `/startupz`, `/readyz` and `/health`. The storage flag in `/health` reflects initialization at API startup. The self-check verifies that server and worker containers use the same image and tests each running server's PostgreSQL connection, migration version, Redis and current S3 read access. Both commands return a nonzero exit status on a failed check.

`--assets` checks byte counts and SHA-256 for every registered private image linked from a file or project snapshot. Run it during a maintenance window or before exposing a restore so the image inventory stays fixed. Allow enough time to read the images. For a service started outside Compose, run `./shiori-server doctor --assets --timeout 5m` with the same environment as the API. These commands use no AI service.

A full smoke check also uses a signed-in account to open a project, read a named version and download a private image. Use a permitted account and an account without the grant. Queue a small Board ZIP export and confirm that the worker finishes it and that the owner can download it.

## Create an instance backup

The backup contains a PostgreSQL custom dump, a cold copy of the SeaweedFS data volume and a manifest with SHA-256 checksums. Together they capture accounts, session records, project and file data, history, grants, attachments and durable job records at the backup time. Redis is rebuilt from empty. Keep instance backups in encrypted storage with access restricted to deployment operators. The database contains sensitive account data and sessions that can still be valid after restore.

1. Check space with `df -h` at the backup destination and estimate room for both the database dump and the full storage volume. Choose a new directory on a protected filesystem.
2. Run the self-check with `--assets`. Have users finish saving and put ingress into maintenance. Stop every API and worker for this database and bucket, then stop SeaweedFS. Keep PostgreSQL running. Quiesce any other writers using these stores.
3. Run the backup and verify its files. A backup is usable once the final manifest exists and verification passes.

```bash
shiori_backup=/secure/backups/shiori-before-upgrade
"${shiori_compose[@]}" stop --timeout 30 server worker
"${shiori_compose[@]}" stop --timeout 30 seaweedfs
"${shiori_ops[@]}" backup "$shiori_backup"
python3 scripts/shiori-ops.py verify-backup "$shiori_backup"
```

Resume with `"${shiori_compose[@]}" up --no-build --wait` if the maintenance window ends here. Keep the previous image and its deployment settings with the backup. For managed PostgreSQL, MinIO or another external S3 provider, use the provider's database and object backup procedures during the same write freeze. Restore both stores to one recovery point and rehearse that procedure with the chosen provider.

## Schedule encrypted offsite copies

Use this workflow for the default Compose stores on Linux or macOS. It writes to a dedicated, mounted filesystem that supports file locks, same-directory atomic renames, and file and directory sync. Use a different device from the local staging directory. For production, place the replica in a separate failure domain and rehearse a real recovery from it. A local disk image is useful for a drill.

1. Install [age](https://github.com/FiloSottile/age) on the backup and recovery hosts. Generate a native identity on a recovery host with `age-keygen -o /secure/recovery/shiori.agekey` and export only its public recipient with `age-keygen -y /secure/recovery/shiori.agekey > shiori.recipients`. Keep the identity at mode `0600` and store a protected recovery copy separately from the app, replica and configuration. Confirm the identity works in a restore drill before rotating keys, and keep previous identities until their backups expire.
2. Set up an encrypted local staging directory and an empty private directory on the mounted replica, both at mode `0700`. Verify the mount before initialization. Initialize once and record the returned `repositoryId` with the deployment config:

   ```bash
   shiori_stage=/secure/local/shiori-offsite-stage
   shiori_replica=/mnt/replica/shiori
   shiori_public=/secure/config/shiori.recipients
   shiori_alert=/usr/local/libexec/shiori-backup-alert
   "${shiori_ops[@]}" offsite init --replica "$shiori_replica"
   shiori_replica_id=REPLACE_WITH_THE_REPOSITORY_ID
   shiori_store=(--replica "$shiori_replica" --repository-id "$shiori_replica_id")
   ```

3. Run a manual backup during a low traffic window before enabling the scheduler. Put ingress into maintenance and let users finish saving before the freeze. The command checks the configured stores, stops the API and worker and then SeaweedFS, captures the cold backup, and resumes service. It encrypts the three backup files with the public recipients and verifies the bytes read back from the replica **after** source health returns. A point becomes visible only after the complete staged copy is verified. Keep the reported point ID and receipt SHA-256 in a trusted job log outside the replica for later recovery verification.

   ```bash
   "${shiori_ops[@]}" offsite run "${shiori_store[@]}" --state "$shiori_stage" \
     --recipients "$shiori_public" --url "$shiori_url" --alert-command "$shiori_alert"
   ```

   ```bash
   "${shiori_ops[@]}" offsite monitor "${shiori_store[@]}" --alert-command "$shiori_alert"
   "${shiori_ops[@]}" offsite prune "${shiori_store[@]}"           # review the plan
   "${shiori_ops[@]}" offsite prune "${shiori_store[@]}" --apply   # run under the authorized retention role
   ```

   The default copy retry budget is three attempts with delays of 5 and 10 seconds. The first failure and exhausted attempts are reported. After a failure, the next run retries the same pending point without another freeze. If the recovered point is already old, take a fresh backup in the next approved window. Monitor verifies the latest usable point from storage and measures its age from capture: warning at 20 hours, critical at 24 hours, or critical immediately if no usable point exists or a newer point is corrupt. The pilot RPO target is 24 hours.

   Run retention daily after replication. It keeps up to two points per day in the latest seven UTC calendar days, one per ISO week in the latest four weeks, and one per calendar month in the latest three months. Overlapping points are kept once, and the newest two available points are always kept. Prune checks the managed points and refuses deletion if it finds a corrupt one. Keep any pre-upgrade backup required for rollback separately so scheduled retention cannot remove it. Plan for up to 21 scheduled points (about 21.4 GiB at the 1.02 GiB rehearsal size); allow at least 30 GiB per location at that size, plus space for recovery staging and extra rollback points. Use storage with separate credentials and deletion protection for the actual offsite copy.

   By default one capture is limited to 2 GiB of database and object payload. The local staging directory can hold one pending point, at most one raw and one encrypted copy of that point plus headers; allow at least twice the configured limit plus staging reserve. Raise `--max-backup-bytes` only after checking space at both sites and budgeting a full recovery. After successful publication the pending copies are removed; a failed run leaves one point available for retry. Use an encrypted staging filesystem because an incomplete job can contain plaintext.

### Run backups and retention unattended

Copy `scripts/offsite-scheduling/backup.example.json` and `retention.example.json` to `/etc/shiori/offsite-backup.json` and `/etc/shiori/offsite-retention.json`. Set the deployment's replica ID and absolute paths. Give each role its own persistent local `scheduleState` directory at mode `0700`. Place both outside the replica and the capture staging directory. The backup role needs Compose access. Run retention with the identity authorized to delete expired copies on the replica.

The OS starts a tick each minute. The backup role takes a backup every 12 hours at 01:00 and 13:00 UTC and checks replica freshness every 15 minutes. The retention role runs once per UTC day from 02:05 onward, after it verifies a backup captured in that day's schedule. Adjust the UTC backup offset and retention start for the deployment's low traffic windows.

The first tick after the scheduler starts checks the latest due window. It takes one cold backup for that window when several windows were missed, or records an existing verified point captured within it. A catch-up can pause writes outside the usual windows. Plan for that pause before enabling the scheduler. A failed run retries after five minutes. If a pending copy predates the current window, the scheduler publishes it before capturing a fresh point. Keep the state directories across reboots.

Set `alertUrl` to an HTTPS receiver that accepts a JSON POST and returns HTTP 2xx after accepting it. An optional `alertTokenFile` at mode `0600` supplies a bearer token. Loopback HTTP works for local tests. An unacknowledged event stays in the schedule state and is retried with the same `Idempotency-Key`. Deduplicate by that key at the receiver. Monitor scheduler exits and verify receipt with the on-call operator. Receiver acceptance and human acknowledgement are separate checks.

On Linux, adjust the checkout, project, Compose file and operator account in the systemd templates before installing them. Use an instance override to assign a different user to retention when needed.

```bash
sudo install -m 0644 scripts/offsite-scheduling/shiori-offsite@.service scripts/offsite-scheduling/shiori-offsite@.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now shiori-offsite@backup.timer shiori-offsite@retention.timer
systemctl list-timers 'shiori-offsite@*'
journalctl -u shiori-offsite@backup.service -u shiori-offsite@retention.service
```

On macOS, use `scripts/offsite-scheduling/com.shiori.offsite.plist` in the Docker Desktop operator's session. Make one LaunchAgent per role and give each a distinct label, config path and log paths. Set the absolute Python and checkout paths. Place the configured files in the operator's LaunchAgents directory for startup at login. Use `plutil -lint` and `launchctl bootstrap "gui/$(id -u)" /path/to/configured.plist` to validate and load each agent. Keep job logs on a protected filesystem and configure their rotation.

Existing systemd units and LaunchAgents can keep calling `scripts/openjam-ops.py`. When switching to the Shiori templates, stop the previous scheduler and wait for any active job to finish. Reuse the original project, role configuration, capture directory and schedule state. Enable one scheduler per role to keep a single writer for each state directory.

Review `schedule_backup_verified` for the point and receipt hash, `schedule_retention` for the kept and removed points, and `schedule_alert_delivered` for the receiver's acknowledgement. A `schedule_alert_delivery_failed` entry leaves the event queued. Check mount access, receiver availability and the task's schedule state before restarting a job.

The XW-152 local drill on 2026-11-12 UTC checked the production 01:00 and 13:00 UTC calendar and ran the same backup logic under launchd with one-minute backup windows. Two consecutive windows published verified encrypted copies. The retention agent removed two expired test points and kept both new points. After two missed windows, reloading the backup agent produced one catch-up copy, which decrypted and contained the test board. The test receiver returned HTTP 503 on the first alert attempt and HTTP 204 for the same event ID on retry. Linux systemd templates passed unit verification. The pilot host still needs validation with its replica, account permissions and on-call receiver.

### Recover from the replica

Keep the target isolated. With the **source** deployment name and replica ID, choose the exact recovery point and use the receipt SHA-256 from the trusted backup log:

```bash
shiori_recovery=/secure/recovery/fetched-shiori
shiori_point=REPLACE_WITH_POINT_ID
shiori_receipt_sha256=REPLACE_WITH_TRUSTED_RECEIPT_SHA256
"${shiori_ops[@]}" offsite fetch "${shiori_store[@]}" "$shiori_point" "$shiori_recovery" \
  --identity /secure/recovery/shiori.agekey --expect-receipt-sha256 "$shiori_receipt_sha256"
```

Choose a new destination under an encrypted private directory with space for both ciphertext and plaintext. Fetch verifies the copy's ciphertext, decrypts with age, verifies the original manifest and both backup payloads, then makes the recovered directory available. It reports transfer, decryption, and inner verification time. If the trusted job log is unavailable, document that loss of provenance before recovering without the receipt argument. Run [Restore an instance](#restore-an-instance) with `shiori_backup="$shiori_recovery"` and a new **target** deployment name. Keep ingress closed until signed-in read/write and permission checks pass, and reapply revocations made after the recovery point.

Set a pilot RTO target of 30 minutes. Measure from starting recovery, including replica access, retrieval, decryption and image preparation, until traffic cutover and the first verified write. Exercise a random retained point monthly and repeat the drill when changing storage or keys. Locally measured times exclude real network and failover. A shorter RPO based on PostgreSQL WAL and object versioning needs its own restore drill at a common recovery point.

## Upgrade a deployment

1. Keep the Compose project name and store configuration. Record the current application image ID, the schema version from `doctor` when available, and a small sample of content, named versions, attachments and grants.
2. Build or load the candidate image. Make and verify the pre-upgrade backup with the previous image settings still available.
3. Set `SHIORI_IMAGE` to the candidate image in the deployment environment. Start the stores and run the explicit migration before the new server or worker accepts traffic.

```bash
"${shiori_compose[@]}" up --no-build --wait postgres redis seaweedfs
"${shiori_compose[@]}" run --rm --no-deps migrate
"${shiori_compose[@]}" up --no-build --wait
"${shiori_ops[@]}" self-check --assets --timeout 5m
python3 scripts/shiori-ops.py quick-check "$shiori_url"
```

4. Open the recorded projects with the same accounts and verify the sample. Confirm that saved edits, history, attachments, allow and deny cases and a new worker export match expectations before reopening ingress. See [Board document migration and rollback](./document-migration.md) if some boards still use the legacy document format.

The binary requires its matching database schema. For rollback after a committed upgrade, restore the pre-upgrade backup into fresh volumes and start the previous image against that restored copy. Verify it before moving ingress. Changes saved after the backup are outside that recovery point. Reconcile any later data or access changes as part of cutover.

## Restore an instance

Prepare a fresh deployment with a different Compose project name and loopback port. Use the PostgreSQL major version, SeaweedFS image and bucket recorded in `manifest.json`. Use the application image that matches the backup schema for the first boot. Restore the deployment secrets from their protected copy. Keep the recovery deployment private until you finish verification.

In a fresh shell, set the variables from the start of this guide for the destination, then run the following commands. `create` leaves SeaweedFS stopped so the archive can be copied into its new volume.

```bash
python3 scripts/shiori-ops.py verify-backup "$shiori_backup"
"${shiori_compose[@]}" up --no-build --wait postgres redis
"${shiori_compose[@]}" create --no-build seaweedfs
"${shiori_ops[@]}" restore "$shiori_backup"
"${shiori_compose[@]}" up --no-build --wait seaweedfs
"${shiori_compose[@]}" run --rm --no-deps server doctor --assets --timeout 5m
"${shiori_compose[@]}" up --no-build --wait
python3 scripts/shiori-ops.py quick-check "$shiori_url"
"${shiori_ops[@]}" self-check --assets --timeout 5m
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
| Replica is missing or copy verification fails | Verify the mount, configured repository ID, permissions and space. Retry the same command with the same staging directory. Do not initialize a replacement over a missing mount. For a corrupt point, keep the evidence and select a different known good point for recovery. |
| Offsite run was interrupted during capture | Keep the replica and staging directory. Manually resume the source with `docker compose up --no-build --wait` in the selected deployment, run the quick check and self-check, then repeat the offsite run with `--confirm-resumed`. If the pending local backup is invalid, inspect and quarantine that one pending directory before starting a new capture. |
| No alert received or pruning is refused | Check the scheduler and the alert executable's exit status, then test delivery to the on-call owner. Prune is blocked by a corrupt point; investigate the point before any manual removal. |
| Recovery fetch was interrupted | Confirm the process has exited. In the private recovery parent, inventory any leftover `.shiori-fetch-*` or older `.openjam-fetch-*` staging from that run before removing it. Start the next fetch with a new destination. |

Use `"${shiori_compose[@]}" logs --tail 100 server worker migrate postgres seaweedfs` for bounded diagnostics. Remove tokens, credentials, and private URLs before sharing logs.
