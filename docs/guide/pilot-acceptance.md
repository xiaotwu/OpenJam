# Pilot acceptance for XW-151 and XW-152

Use this runbook to qualify the actual pilot ingress and backup workflow before opening access to pilot users. The reference deployment uses a host proxy and Compose PostgreSQL, Redis and SeaweedFS. If the pilot uses managed PostgreSQL, MinIO or another S3 provider, keep the same ingress checks and run the storage provider's backup and restore procedure at a common recovery point. The default Compose backup command applies to the default stores.

Start with the [pilot handoff](./pilot-handoff.md) to confirm the frozen candidate, required inputs and rollback point.

Record the result of each gate as Pass, Fail, Pending or N/A with its UTC time, operator and evidence. Meetings can be N/A when the pilot leaves media disabled. Keep the pilot closed if a required gate fails, if a result is missing, or if the rollback point or account access is uncertain.

In the collaboration checks, A and B are the owner and editor browsers. In the recovery checks, source A and target B are separate OpenJam deployments.

| Gate | Local evidence | Pilot pass standard |
| --- | --- | --- |
| 151-A HTTPS and sign-in | **Passed locally on RC2.** The Caddy rehearsal used loopback, a local CA and two Chrome sessions. Verified TLS 1.3, permanent redirect, health and cookie flags. | **Pending.** The actual hostname and certificate chain validate on both clients, HTTP permanently redirects to the same HTTPS host and path, the edge and local probes pass, and both clients sign in with `wb_session` set to Secure, HttpOnly and SameSite=Lax. The application port is bound to loopback. |
| 151-B WebSocket and reconnect | **Passed locally on RC2.** Both Caddy sessions got `101` on `/ws/v2`, saw each other's edits and reconnected after the backup. In the separate replica restart, all 50 affected sessions rejoined and applied the 13 missed changes, with p95 216.7 ms from readiness and 0 HTTP 429. The earlier run at `7026a2f` covered legacy `/ws`. | **Pending.** On representative client networks both board connections get `101` over WSS. Edits travel both ways. After a real disconnect and a new upgrade, the client catches up without a reload and can edit again. The clients agree on the snapshot epoch, sequence and hash after sync settles. |
| 151-C Private files and revocation | **Passed locally on RC2.** The private PNG bytes matched both downloads and the ZIP entry. Revocation closed the live connection and returned `403` for the snapshot, write, image and previously issued artifact. | **Pending.** Both granted users can read the same private PNG and the editor can generate a new Board ZIP with that PNG. Removing the editor closes the live subscription and denies all four paths. The owner keeps access. |
| 151-D Meetings, if enabled | The XW-151 loopback drill covered the app edge and board collaboration. | **Pending if enabled.** On the actual client networks both participants receive audio, video and screen share and recover media after reconnect. The revoked participant loses access. |
| 152-A Replica and backup | **Passed locally on RC2** with an encrypted copy on a separate local mount, receipt verification, monitoring and retention preview. Earlier runs at `7026a2f` and `e05c7ac` covered a roughly 1.02 GiB backup and rejection of bad ciphertext, a wrong identity and a wrong trusted receipt. | **Pending.** The real replica is in an independent failure domain. Operators verify mount behavior, role permissions, deletion protection and capacity. A verified encrypted point has a capture time and a receipt SHA-256 in a trusted log outside the replica. The source resumes and accepts a confirmed write. |
| 152-B Schedule, retention and alerts | **Passed locally** at `0b7d92e`. A native launchd drill used one-minute windows, pruned two expired samples, coalesced missed windows into one backup, and retried a `503` with the same alert ID to a `204`. The 12-hour calendar and systemd template passed configuration checks. | **Pending.** Observe two consecutive scheduled backups 12 hours apart on the pilot. A scoped drill confirms one catch-up after missed windows, keeps protected points during retention, and records receiver acceptance and human acknowledgment. |
| 152-C Restore and rollback | **Passed locally on RC2.** A → empty B → A through Caddy, with B's accepted write reconciled into A. See the [handoff](./pilot-handoff.md) for the recovery point, timing and directory correction. Separate runs at `7026a2f` and `e05c7ac` covered the roughly 1 GiB scale and schema 14 to 23 upgrade and rollback. | **Pending.** Restore from the actual replica into an empty deployment and pass data, history, asset and permission checks. The operator demonstrates the selected rollback path. **RPO ≤ 24 hours and RTO ≤ 30 minutes**, including real retrieval, key access, image preparation and ingress cutover in the RTO. |

## 1. Prepare the pilot

- Record the application commit and image ID or digest, Compose project and file paths, pilot origin and proxy, storage layout and bucket, backup window, replica ID, operator and on-call contact, and the empty restore target's name and port. Record whether Meetings is enabled.
- Prepare two separate browsers or profiles and two synthetic accounts. Give A ownership of a restricted Board in a Team Project. Invite B to the Team and grant B Editor on the Project. Use a small private PNG, a named version and a distinctive test edit. Keep B free of direct Board grants, share links or invitations that would preserve access after removal.
- Keep a known-good proxy configuration and deployment configuration with the previous image and a verified pre-change recovery point. Save these separately from scheduled retention. Record the approved restore identity's retrieval procedure. Limit participant access at the edge until the acceptance run ends.
- Provision an operator-owned recovery parent with mode `0700` on encrypted staging before the window. Use a private child directory if the staging mount root has broader permissions. Verify the parent is a real directory and reserve a new path for the decrypted point.

Copy `scripts/pilot-acceptance/compose.env.example` to a protected file at mode `0600`. Set the approved image and deployment secrets, keep the backend port on loopback and set `CORS_ORIGINS` to the exact pilot HTTPS origin. The proxy port must match `OPENJAM_PUBLISH_PORT`. Configure `OPENJAM_TRUSTED_PROXIES` with the immediate address or narrow CIDR seen by the API if the deployment uses forwarded client addresses. Use the actual Docker gateway address when it is the immediate peer.

For a host running Caddy, start with `scripts/pilot-acceptance/Caddyfile.example` and `Caddyfile.maintenance.example`. Replace the sample hostname in both and keep the same TLS settings. Use a certificate chain trusted by the actual clients. Keep `skip_install_trust` in the single global options block so Caddy leaves local trust stores alone. The serving config forwards paths, including the WebSocket routes, to the local app port. On a shared proxy, merge the pilot site block into the full configuration and preserve the other sites. Validate the full configuration and preserve its known-good copy. [Caddy HTTPS](https://caddyserver.com/docs/automatic-https) · [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) · [Caddy global options](https://caddyserver.com/docs/caddyfile/options#skip_install_trust)

In Bash from the approved checkout, fill these values before using the command blocks. The defaults for the systemd examples use the project `openjam`. Adjust both service instances if you choose another project or checkout.

~~~bash
pilot_project=openjam
pilot_env=/etc/openjam/compose.env
pilot_host=pilot.example.test
pilot_local=http://127.0.0.1:8080
pilot_compose=(docker compose --project-name "$pilot_project" --env-file "$pilot_env")
pilot_ops=(python3 -B scripts/openjam-ops.py --project "$pilot_project" --env-file "$pilot_env")

docker context show
"${pilot_compose[@]}" config --quiet
"${pilot_compose[@]}" config --images
~~~

Before the write hold, run this check on the recovery host as the account that will fetch the backup. On Linux, verify the recovery parent and the new destination with the following commands.

~~~bash
restore_parent=/secure/recovery/openjam
restore_archive="$restore_parent/pilot-point"
test -d "$restore_parent" && test ! -L "$restore_parent" &&
  test "$(stat -c '%a:%u' -- "$restore_parent")" = "700:$(id -u)" &&
  test ! -e "$restore_archive" && test ! -L "$restore_archive"
~~~

For a new pilot instance, start the configured image with `"${pilot_compose[@]}" up --no-build --wait` in the approved window. For an existing instance, take and verify a pre-upgrade backup before the [upgrade steps](./operations.md#upgrade-a-deployment). Check the running stack before installing the validated serving config at the edge.

~~~bash
"${pilot_compose[@]}" ps --all
python3 -B scripts/openjam-ops.py quick-check "$pilot_local"
"${pilot_ops[@]}" self-check --assets --timeout 5m
docker inspect --format '{{.Image}}' "$("${pilot_compose[@]}" ps -q server)"
~~~

Confirm the installed and required schemas match, the server and worker use the approved image, and the asset audit passes. Run the audit while the inventory is stable. Record the running image ID and the audit count.

## 2. Verify the edge with two clients

Run the edge probe from both client networks against the real hostname. It uses normal certificate trust and TLS 1.2 or later, checks the permanent redirect and the HTTPS response codes, then runs the application's health checks. Inspect the browser certificate details as well. Record the certificate hostname and expiry, route tested, and client network. Confirm the raw app port and the internal stores are inaccessible from those networks.

~~~bash
bash scripts/pilot-acceptance/check-edge.sh "$pilot_host"
~~~

For a joint rehearsal of XW-151 and XW-152, complete steps 1–3 below and prepare the revocation probe while B still has access. Take the manual backup in section 3 with B still an Editor. Reopen the edge to A, confirm both browsers have reconnected, make the source-only marker, and then complete step 4 below. This gives the restore drill a known Editor grant at capture and a later revocation to replay. Run all five steps in order when checking XW-151 on its own.

1. **Sign in and establish WSS.** In both signed-in browsers inspect the cookie flags and the `/ws/v2` request in DevTools. Open the same Board by its deep link and confirm `101` and a working subscription in each session. If legacy clients are in scope, verify an authenticated `/ws` upgrade too.
2. **Edit and reconnect.** Add distinct text in A and B and verify it appears in both. Interrupt B until its old socket closes, make another edit in A, reconnect B and verify a fresh `101`, that the missed edit appears, and that B can add a final edit. Compare `epoch`, `seq` and `hash` from `GET /api/v2/boards/BOARD_ID/snapshot` in both authenticated sessions after sync settles.
3. **Verify the private PNG and export.** Add the PNG in A and compare bytes downloaded by both accounts. In B start a new Board ZIP export, wait for success and download it. Record the Board ID, image ID, B's job ID and SHA-256. The downloaded PNGs and the ZIP's `assets/<image ID>` entry must match the uploaded image. Verify the ZIP locally by substituting the four paths and the asset ID below.
4. **Revoke B while connected.** Prepare the browser probe below, then remove B's Team membership in A. In B confirm the subscription closes and the editor disappears without a reload. Run the probe for the snapshot, write, image and B's own export artifact. Each returns `403`. Confirm A can still open the Board and download the image.
5. **Verify Meetings if enabled.** Follow the [Meetings quick check](./meetings.md#quick-check) using the actual media routes, ICE addresses and TURN if the pilot requires it. Check both client networks.

~~~bash
python3 - /path/to/upload.png /path/to/a.png /path/to/b.png /path/to/board.zip ASSET_ID <<'PY'
import hashlib
from pathlib import Path
import sys
from zipfile import ZipFile

upload, a, b, bundle, asset = sys.argv[1:]
expected = hashlib.sha256(Path(upload).read_bytes()).hexdigest()
with ZipFile(bundle) as archive:
    digests = [hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in (a, b)]
    digests.append(hashlib.sha256(archive.read("assets/" + asset)).hexdigest())
if any(digest != expected for digest in digests):
    raise SystemExit("FAIL private image bytes differ")
print("PASS private image SHA-256", expected)
PY
~~~

In B's browser console, prepare the probe below while B still has access. Fill the three IDs for the synthetic Board, image and B's ZIP job. After revocation, run `await window.checkPilotRevocation()` in the same tab. The probe uses B's existing session and reports status codes.

~~~js
{
  const board = "/api/v2/boards/" + encodeURIComponent("BOARD_ID");
  const image = encodeURIComponent("ASSET_ID");
  const job = encodeURIComponent("B_JOB_ID");
  const read = (url) => fetch(url, { cache: "no-store" });
  const before = await read(board + "/snapshot");
  if (!before.ok) throw new Error("Open the synthetic Board as B first");
  const { epoch, seq, document } = await before.json();

  window.checkPilotRevocation = async () => {
    const responses = await Promise.all([
      read(board + "/snapshot"),
      fetch(board + "/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocolVersion: 2, epoch, baseSeq: seq,
          clientId: crypto.randomUUID(), commandId: crypto.randomUUID(),
          operations: [{ kind: "rename", value: "Pilot denied write", expected: { name: document.name } }]
        })
      }),
      read(board + "/assets/" + image),
      read("/api/v2/jobs/" + job + "/artifact")
    ]);
    const statuses = responses.map((response) => response.status);
    console.table(Object.fromEntries(["snapshot", "write", "image", "artifact"].map((key, i) => [key, statuses[i]])));
    if (statuses.some((status) => status !== 403)) throw new Error("Revocation gate failed");
  };
}
~~~

Save response codes, timestamps, receipt hashes and relevant `X-Request-ID` values. Capture only the cookie flags and socket path/status from browser tools. Use bounded logs with `"${pilot_compose[@]}" logs --tail 100 server worker migrate` and the proxy's service log. Remove cookies, authorization headers, signaling query strings and private URLs before attaching evidence.

## 3. Qualify the backup schedule on the pilot

Prepare the replica directory, an encrypted local staging filesystem, the public recipients file, and the actual receiver in the [schedule templates and setup](./operations.md#run-backups-and-retention-unattended). Keep the decrypt identity on the recovery side. Verify the filesystem mount, a separate failure domain, free space and which identity can read, publish or prune. Use a scoped test point to check locking, atomic publication, sync, interruption and deletion protection on the actual provider. Establish the agreed UTC backup window and named on-call owner.

~~~bash
pilot_replica=/mnt/openjam-replica/openjam
pilot_stage=/var/lib/openjam-offsite/capture
pilot_recipients=/etc/openjam/backup.recipients

df -h "$pilot_replica" "$pilot_stage"

# Run once, only for a new empty mode-0700 directory on the confirmed mount.
"${pilot_ops[@]}" offsite init --replica "$pilot_replica"
~~~

Record the `repositoryId` from initialization. For an existing replica, use the recorded ID and skip initialization. An empty replica has no verified point: `offsite monitor` reports critical and exits 1 until the first valid capture. Start with a manual backup before using monitor and the retention preview as gates for the scheduler.

Save a distinctive marker in the synthetic Board, let test users finish saving, then put the edge in maintenance and confirm HTTPS 503. Run the backup below. It freezes the default Compose stores and resumes the app before encrypting and copying. Keep the `replica_verified` point ID, capture time and receipt SHA-256 in a trusted log outside the replica. Check that the source is healthy before reopening the edge for testers, then add a second marker and confirm its readback. Record both the backend freeze from `source_resumed` and the edge interval from the first maintenance 503 to the confirmed write. They measure different things. If publication fails after the source resumes, follow the [pending backup procedure](./operations.md#schedule-encrypted-offsite-copies) and keep the backup gate failed until verification succeeds.

~~~bash
pilot_replica_id=REPLACE_WITH_REPOSITORY_ID
pilot_store=(--replica "$pilot_replica" --repository-id "$pilot_replica_id")

"${pilot_ops[@]}" offsite run "${pilot_store[@]}" --state "$pilot_stage" \
  --recipients "$pilot_recipients" --url "$pilot_local" &&
"${pilot_ops[@]}" offsite monitor "${pilot_store[@]}" &&
"${pilot_ops[@]}" offsite prune "${pilot_store[@]}"  # preview only
~~~

On the pilot, install the selected scheduler configuration, observe two real backup windows and record both verified point IDs. On Linux, use `systemctl list-timers --all 'openjam-offsite@*'` and `journalctl -u openjam-offsite@backup.service -u openjam-offsite@retention.service --since today`. Check `schedule_backup_verified` and the daily `schedule_retention` result against the prune preview. Use a separate synthetic deployment and replica namespace for missed-window, receiver failure and expired-point tests on that host. Prove that restart publishes one catch-up point, that protected points remain, that retries preserve the alert ID, and that the actual duty recipient both receives and acknowledges the test. Record the receiver and acknowledgment times separately.

## 4. Restore from the replica and measure

Start the UTC clock when the operator receives the drill signal, before retrieving the recovery key and archive or preparing the image. Select the latest verified point suitable for the drill using its independently recorded receipt hash. Record which test markers bracket that specific capture. If a later capture includes both markers, prepare a new pair around the point used for the drill. Prepare an empty target B with a new Compose project, fresh volumes and a different loopback port. Match the restored PostgreSQL major version, SeaweedFS image and bucket from the manifest and use the application image compatible with that schema.

Fill the values on the recovery host. Prepare `restore.env` with the matching image and store settings and set `OPENJAM_PUBLISH_PORT=18081`. Use the **source** deployment and repository ID for `fetch`, then the **target** project for `restore`. Use the private recovery parent prepared in section 1. The restore tool requires an empty target.

~~~bash
restore_project=openjam-pilot-restore
restore_env=/etc/openjam/restore.env
restore_local=http://127.0.0.1:18081
restore_identity=/secure/recovery/openjam.agekey
restore_point=REPLACE_WITH_POINT_ID
restore_receipt=REPLACE_WITH_TRUSTED_RECEIPT_SHA256
restore_compose=(docker compose --project-name "$restore_project" --env-file "$restore_env")
restore_ops=(python3 -B scripts/openjam-ops.py --project "$restore_project" --env-file "$restore_env")

[[ -n "$restore_project" && "$restore_project" != "$pilot_project" && "$restore_local" != "$pilot_local" ]] &&
"${pilot_ops[@]}" offsite fetch "${pilot_store[@]}" "$restore_point" "$restore_archive" \
  --identity "$restore_identity" --expect-receipt-sha256 "$restore_receipt" &&
"${restore_compose[@]}" config --quiet &&
"${restore_compose[@]}" up --no-build --wait postgres redis &&
"${restore_compose[@]}" create --no-build seaweedfs &&
"${restore_ops[@]}" restore "$restore_archive"
~~~

Before booting the API, decide how to handle restored sessions. Replay known invalidations before opening the edge. If individual revocations cannot be accounted for and the recovery owner approves a fresh sign-in for everyone, invalidate the restored sessions in B while its API and worker are stopped and Redis is still empty.

~~~bash
running=$("${restore_compose[@]}" ps --status running -q server worker) &&
cache_keys=$("${restore_compose[@]}" exec -T redis redis-cli DBSIZE) &&
[[ -n "$restore_project" && "$restore_project" != "$pilot_project" && -z "$running" && "$cache_keys" == 0 ]] &&
"${restore_compose[@]}" exec -T postgres sh -ec '
  exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -c "DELETE FROM public.sessions;" -c "SELECT count(*) FROM public.sessions;"
'
~~~

Start B with its edge restricted and run the checks.

~~~bash
"${restore_compose[@]}" up --no-build --wait seaweedfs &&
"${restore_compose[@]}" run --rm --no-deps server doctor --assets --timeout 5m &&
"${restore_compose[@]}" up --no-build --wait &&
python3 -B scripts/openjam-ops.py quick-check "$restore_local" &&
"${restore_ops[@]}" self-check --assets --timeout 5m
~~~

Keep B private. Compare the recovery-point samples, including project ownership and access, named versions, private image hashes and a new ZIP export. The pre-capture marker must appear in B and the source-only post-capture marker must be absent. Check the captured ACLs against the record before replaying changes. Reapply all permission changes made after capture using a fresh owner session over restricted HTTPS or the authenticated local API. If sessions were cleared, confirm an old session is rejected and both test users can sign in afresh. A revoked account may still sign in; its resource access must fail. Verify the denials again before opening the edge. Follow the [restore procedure](./operations.md#restore-an-instance) if a restore is interrupted or the prior image predates `doctor`.

For cutover, keep participant access restricted. Pause both deployments' schedulers and wait for any active backup to finish. Hold HTTPS in maintenance and verify 503. Stop source API and worker processes and any other writers before allowing test writes to B. When the source outage is part of the recovery drill, record that outage and stop its writers at the start of the drill. Before changing the proxy, check that no source writer is running and that B is healthy with both writer services running. Then reload the approved serving config pointing to B. Run the edge check and verify fresh logins, one allowed write with readback and one denied access using the restricted pilot edge. Record the first confirmed write time and the final selected writer before opening pilot access.

~~~bash
"${pilot_compose[@]}" stop --timeout 30 server worker &&
source_running=$("${pilot_compose[@]}" ps --status running --services server worker) &&
target_running=$("${restore_compose[@]}" ps --status running --services server worker) &&
[[ -z "$source_running" && $(sort <<< "$target_running") == $'server\nworker' ]] &&
python3 -B scripts/openjam-ops.py quick-check "$restore_local"
~~~

If B stays active under a different Compose project name, initialize a separate replica namespace and use B's new repository ID, capture directory and scheduler state. The replica marker is bound to its source deployment; B cannot publish to A's repository by copying A's settings. Preserve A's recovery points, and verify a first backup from B before enabling its scheduler. During a rehearsal keep both schedulers paused until the chosen writer is back.

Use the source outage or simulated outage timestamp as the RPO reference. The restore start timestamp is the drill signal, which may be the same time. Record capture, restore start, outage and first confirmed write as explicit UTC timestamps.

~~~bash
python3 - "$capture_utc" "$outage_utc" "$restore_started_utc" "$first_verified_write_utc" <<'PY'
from datetime import datetime, timedelta
import sys

def utc(value):
    value = value[:-1] + "+00:00" if value.endswith("Z") else value
    stamp = datetime.fromisoformat(value)
    if stamp.utcoffset() != timedelta(0):
        raise ValueError("Use explicit UTC timestamps")
    return stamp

capture, outage, started, written = map(utc, sys.argv[1:])
rpo = (outage - capture).total_seconds()
rto = (written - started).total_seconds()
print(f"RPO {rpo:.1f} s, RTO {rto:.1f} s")
raise SystemExit(0 if 0 <= rpo <= 86400 and 0 <= rto <= 1800 else 1)
PY
~~~

## 5. Roll back when a gate fails

1. **Hold the edge and stop new changes.** Switch the pilot site to its prepared maintenance config. Validate and reload the full proxy config and confirm HTTPS `503` on `/readyz` from a client. Pause backup and retention timers on both deployments and check for in-flight jobs. On Linux with the templates, use `sudo systemctl stop openjam-offsite@backup.timer openjam-offsite@retention.timer`, then inspect the corresponding services and wait for any active capture to resume the source or follow the interrupted-job procedure. Stop the serving candidate's API and worker with the explicit Compose project and `stop --timeout 30 server worker`. Keep the database, object volumes, logs and receipts.
2. **Choose the rollback branch.** For a proxy-only change, reload the saved serving proxy config after the previously verified backend passes its local check. If the application changed and the earlier schema and stores are still compatible, restore the saved image and environment, start the previous stack and run its checks. If a migration committed, prepare a fresh project and restore the verified pre-change backup with the previous image and matching stores using step 4. If that archive is already local, run `python3 -B scripts/openjam-ops.py verify-backup "$restore_archive"` and continue with the target commands. Keep all affected writers stopped while choosing the authoritative data.
3. **Reconcile before reopening.** Preserve the stopped candidate's stores and logs. Compare its final accepted writes and permission changes with the chosen target's state. In a rehearsal with only one intentional write, record its file, element, value and revision; apply it through the selected writer's normal edit path after checking for conflicts, then read it back. Verify the chosen target still contains any pre-cutover source-only writes and enforces the final access policy. If changes are unknown or cannot be reconciled, keep maintenance enabled until the owner approves a recovery choice and any data gap. This drill's single test write does not establish an automatic merge for diverged instances.
4. **Reopen with one writer.** While the failed candidate stays stopped, repeat the local health and asset checks for the selected target. Route the restricted edge back, verify fresh login, allowed write with readback and denied access. Recheck that the rejected writer is stopped, reopen pilot access after sign-off, and re-enable scheduling only for the selected deployment. Record the chosen point, reconciled changes or approved gap, timestamps and approver.

For Caddy, keep the prepared full maintenance and serving files and use `caddy validate --config FILE --adapter caddyfile` before each change. Install the approved file at the service's configured path and reload the service so restart uses the same file. Preserve the previous configuration until both health and browser checks pass. [Caddy commands](https://caddyserver.com/docs/command-line#caddy-validate)

From a pilot client, verify the maintenance response before switching the upstream. After the switch, run the edge probe in step 2 for the selected deployment.

~~~bash
test "$(curl --disable --silent --show-error --max-time 10 --output /dev/null \
  --write-out '%{http_code}' "https://$pilot_host/readyz")" = 503
~~~

## Local rehearsal setup

Use two disposable Compose projects with separate named volumes and different loopback ports. Use the production cookie settings in the example environment. Keep Meetings media and the backup schedulers off for this run; use the separate acceptance steps to qualify them. Use synthetic data and mount the replica on a separate local test volume. This checks the filesystem and recovery workflow, but does not simulate loss of the host or its storage.

Use both Caddy templates. Set an explicit loopback bind and nonstandard HTTP, HTTPS and admin ports. For serving, make one config per upstream. Use a local CA and a test leaf with the template hostname as a DNS SAN; include the subject and authority key identifiers so clients with strict chain validation can use it. Set `tls CERT KEY` in both template site blocks and use the same certificate in maintenance. Keep `skip_install_trust` and separate Caddy data and config directories. Route the test hostname only for the test clients. With high loopback ports, a test-only HTTP and CONNECT relay can map the expected 80/443 for `check-edge.sh` to those ports. Set `CURL_CA_BUNDLE` and `SSL_CERT_FILE` for that probe process and use an isolated browser context for the fixture certificate. Keep the system trust store and normal proxy settings unchanged.

For the simulated outage, take the edge to maintenance and stop A's writers before retrieving the replica. Leave A's data volumes in place so the rollback can select the original A deployment. While B is the selected writer, accept only the test write that you will reconcile during rollback. Record the candidate, sample size and assumptions next to the measured timings.

The 2026-11-12 UTC rehearsal ran schema 23 with two test accounts, one Team Project, one file of each kind (Board, Doc, Sheet, Slides) and one private PNG. The two browsers saw both edits; after the editor's network tunnel was restored, catch-up took **2.14 s**. The encrypted payload was **2,645,463 bytes**. The backend write freeze was **24.15 s** and the edge was held for **24.69 s** to the confirmed source write. From the recovery start to a confirmed write on B through Caddy took **20.13 s**. B had the captured versions, links, asset and access grants. Old sessions were rejected and the later revocation was replayed before cutover. The simulated capture-to-outage gap was **39.54 s**. From putting B's edge in maintenance to a confirmed write on A took **8.00 s**; A retained its post-capture marker and B's reconciled write. These are small-sample local timings with the image and identity already available. Use the separate scale evidence and measure the pilot on its own storage, network and key retrieval path.

## Acceptance record

Copy this record into the pilot handoff. Put only sanitized observations in XW-151 and XW-152.

~~~text
Run ID / UTC window / operator / approver
Application commit and image ID / actual proxy / HTTPS origin
Source project and schema / target project and schema / media enabled
Replica ID / capture UTC / trusted receipt SHA-256 / encrypted bytes / authorized roles
Backend write freeze / edge hold to confirmed source write
Outage UTC / restore start UTC / first verified write UTC / RPO / RTO
151-A / 151-B / 151-C / 151-D / 152-A / 152-B / 152-C results and evidence
Rollback branch exercised / maintenance to verified write / authoritative writer / replay or approved data gap
Go or hold / issue references and remaining actions
~~~
