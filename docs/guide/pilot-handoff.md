# Pilot handoff for openjam-pilot-20261112-rc2

RC2 is frozen locally for Linux ARM64 and Linux AMD64. Both use source commit `ae5686a76ab05c41fdc692e6bb2d346b50684211` and require database schema 23. The local Git tag is `openjam-pilot-20261112-rc2`. Follow the [joint pilot checklist](./pilot-acceptance.md) when the pilot host and operating window are available. Meetings media and the external AI profile are off for this candidate.

## 1. Identify and load the candidate

| Item | Linux ARM64 | Linux AMD64 |
| --- | --- | --- |
| Compose image and OCI manifest | `openjam-pilot@sha256:2bf16887e48ebc3bc415221d9e08ddf28df7aa9f68793cd5a9faddca4ab9a741` | `openjam-pilot@sha256:31e28b2ed626b5d2e9c99eefff206d0ec4eb1a937896c0e03f0416733e467e31` |
| Local Docker tag | `openjam-pilot:20261112-rc2-arm64` | `openjam-pilot:20261112-rc2-amd64` |
| OCI configuration digest | `sha256:d3e4c4297c6b010faa08ff11c339d107cf6994c258dfa230bccd628af01b36a1` | `sha256:e778e55fb9358150fb3065e54ff4e4c1b73a9293a68bf5e25d6163f2cb6d95b3` |
| Offline artifact | `openjam-xw154-linux-arm64.oci.tar` (91,048,448 bytes) | `openjam-pilot-20261112-rc2-linux-amd64.oci.tar` (91,357,696 bytes) |
| Offline artifact SHA-256 | `46a9e00f50d489cc17e0cee00aa73db32b388940e8a2318d566dfd2f2d3e8180` | `ccd08b1c1a27bb99516865d82ec4194b0470e18c9d9a4f9cf0a3373b15f3255e` |
| Local archive and checksum directory | `xw-154-image-sync` | `xw-151-152-pilot-rc2-amd64` |
| Local acceptance evidence directories | `xw-151-152-pilot-rc2` | `xw-151-152-pilot-rc2-amd64` and `xw-151-152-pilot-rc2-amd64-edge` |

The lock at `scripts/pilot-acceptance/rc2.lock.json` records both artifacts, the pinned stores and their per-platform manifests, the configuration template hashes and the evidence hashes. Each archive contains the application for server, worker and migrate. The Git tag points to the runtime source.

On the Linux target, copy the matching archive and checksum through the approved private channel. Run the following from that archive directory. Docker reports the architecture of the engine for the current context.

~~~bash
(
  set -eu
  platform=$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')
  case "$platform" in
    linux/arm64)
      archive=openjam-xw154-linux-arm64.oci.tar
      candidate=openjam-pilot@sha256:2bf16887e48ebc3bc415221d9e08ddf28df7aa9f68793cd5a9faddca4ab9a741
      ;;
    linux/amd64)
      archive=openjam-pilot-20261112-rc2-linux-amd64.oci.tar
      candidate=openjam-pilot@sha256:31e28b2ed626b5d2e9c99eefff206d0ec4eb1a937896c0e03f0416733e467e31
      ;;
    *)
      printf 'Unsupported Docker engine platform: %s\n' "$platform" >&2
      exit 1
      ;;
  esac
  sha256sum -c "$archive.sha256"
  docker image load --input "$archive"
  test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$candidate")" = "$platform"
  test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$candidate")" \
    = ae5686a76ab05c41fdc692e6bb2d346b50684211
  printf 'OPENJAM_IMAGE=%s\n' "$candidate"
)
~~~

Set the printed `OPENJAM_IMAGE` in the protected Compose environment. Check `docker compose config --images` and provision the three locked store images for the selected platform before starting with `--no-build --pull never`. In the pilot record, save the engine architecture and the app and store manifests actually used. On Docker Desktop for macOS, `shasum -a 256 -c` can check the archive, and `DOCKER_DEFAULT_PLATFORM=linux/amd64` selects the AMD64 images during an emulated rehearsal.

## 2. Prepare the protected deployment files

| Inputs | Where to start | What the operator must fill in |
| --- | --- | --- |
| Application and data stores | `docker-compose.yml` and `scripts/pilot-acceptance/compose.env.example` | Candidate digest, exact HTTPS origin, loopback app port, database and object-store secrets, and immediate trusted proxy if needed. Prepare a separate Compose project and loopback port for recovery B. |
| HTTPS and maintenance | `scripts/pilot-acceptance/Caddyfile.example` and `Caddyfile.maintenance.example` in the same directory | Pilot hostname, client-trusted certificate, both upstream ports and a saved known-good Caddy configuration. Validate the full config. If the host uses another proxy, qualify its equivalent routes. |
| Backup, retention and alerts | `scripts/offsite-scheduling/backup.example.json`, `retention.example.json` and the systemd or launchd templates in that directory | Replica mount and repository ID, encrypted staging, public age recipients, separate role and schedule state directories, approved receiver and named on-call owner. Keep decryption credentials separate. |
| Preflight and recovery | `scripts/pilot-acceptance/check-edge.sh` and `scripts/openjam-ops.py` | Run the edge probe from both client networks and the local quick check and self-check from the selected host; use the [operations guide](./operations.md) for the backup and restore commands. |

The default backup commands apply to the pinned Compose PostgreSQL, Redis and SeaweedFS setup. If the pilot uses managed PostgreSQL, external S3 or another store, confirm and rehearse that provider's backup and restore procedure at a common recovery point before using real pilot data. Keep the filled environment files and credentials outside the handoff and out of Linear.

## 3. Confirm the rollback point

- **Existing deployment:** Before the change, record the previous image digest, installed schema, Compose project, protected environment location, proxy config checksum and stores. Take and verify an instance backup; record its point ID, capture UTC, trusted receipt SHA-256, manifest/schema, replica location and how an authorized operator can fetch and decrypt it. Keep the old image and recovery point available outside scheduled expiry. If a migration commits, restore the verified old backup to empty volumes with the old compatible image before moving ingress. Repointing Caddy alone does not roll back a schema change.
- **Fresh deployment:** Record that there is no earlier dataset. The initial fallback is the saved maintenance config and stopped writers. Before inviting pilot users, verify the first encrypted recovery point from the selected deployment. Use that point, or a later verified point, for any subsequent restore.
- **Failed cutover after writes:** Hold the edge at 503, stop the rejected API and worker, preserve both stores, reconcile accepted writes and access changes, then route to one verified writer. If the changes cannot be reconciled, keep maintenance until the owner approves the recovery point and any data gap. Follow [the rollback steps](./pilot-acceptance.md#_5-roll-back-when-a-gate-fails).

| Rehearsal record | Value |
| --- | --- |
| ARM64 encrypted capture and receipt | `20261112T223135Z-2b4eb2b5d4d10d6c` at `2026-11-12T22:31:35.429440+00:00` UTC. SHA-256 `f529070707200969e156adcd9f6f495de8e198bcc74a1882b63dda39c5b7621a` |
| AMD64 encrypted capture and receipt | `20261112T232358Z-151ebd3f4453733a` at `2026-11-12T23:23:58.213982+00:00` UTC. SHA-256 `efe640fd233e87386e665b29f8755d5480c9d25c1d46af6d7410a5d230d85af8` |
| AMD64 Caddy switchback capture and receipt | `20261112T235234Z-48d29ae7fcd6462f` at `2026-11-12T23:52:34.809106+00:00` UTC. SHA-256 `ac0e13746526972ac14e3757ee466c305b9522a0ea6c05a9df5547975f5edfb1` |
| ARM64 same-schema switchback | RC2, schema 23. Caddy returned to source A after replaying B’s one confirmed write. A’s source-only write and the revoked grant were preserved. |
| ARM64 serving and maintenance Caddy configurations | SHA-256 `6d818f5252574cce91a03d5c433f03e3e352247d683958c79978b7f7eb260c85` / `25cfef4adc931991182987e0041b692f18d29d123946b121d33de6f682a93255` |
| AMD64 same-schema switchback | RC2, schema 23. Source A was selected after reconciling B’s one confirmed write. A retained its post-capture write and the revocation. The lock records the checksums for the A, B and maintenance Caddy configurations. |

The local points are synthetic records. Retained evidence includes receipts and manifests. The lock at `scripts/pilot-acceptance/rc1.lock.json` identifies the archived earlier candidate. Record the image actually running on the pilot, its schema and a verified pilot recovery point before opening the operating window. For a fresh pilot, record the maintenance fallback and first verified encrypted point.

## 4. What passed locally

| Scope | ARM64 evidence on Apple Silicon |
| --- | --- |
| Concentrated reconnect | With 100 authenticated sessions across two API replicas, 50 affected sessions all rejoined and applied 13 missed changes after the replica restart. Recovery p95 **216.7 ms** from readiness, **0 HTTP 429**, zero lost or duplicate commits. |
| Caddy and collaboration | TLS 1.3 with a local CA, permanent redirect, two Chrome sign-ins and WSS reconnect after the backup. Revocation closed the live subscription. Snapshot, write, image and export returned 403 for the removed editor. |
| Encrypted replica and recovery | 736,101 bytes of verified ciphertext. Source writers paused **12.00 s** and the HTTPS write hold lasted **21.26 s**. B restored Board, Doc, Sheet, Slides, named versions, Project history, the internal link, private PNG, ZIP and grants. |
| Cutover and switchback | After moving recovery to a private `0700` directory, the drill reached the first verified B write in **19.859 s**. From the original signal, including the rejection of the `0755` mount root and the correction, it took **161.795 s**. Switchback to the first confirmed A write took **6.656 s**. Both switches enforced one active writer. |
| 5,000-object browser test | XW-154 used this exact image. All visible images loaded over 20 mixed zoom and edit rounds. Peer-visible p95 was **225.5 ms** with **0** image or sync 429s. |

| Scope | AMD64 evidence in Docker Desktop emulation on Apple Silicon |
| --- | --- |
| Offline load and cold start | All five OCI layers, the manifest, configuration and x86-64 binary verified. Loaded from the offline archive. Compose started from empty volumes in **11.97 s**. Migration exited successfully, both schema checks reported 23, and all six service manifests resolved to AMD64. |
| Caddy HTTPS and WSS | Two independent Chrome sessions at 1440 × 900 signed in over TLS 1.3, exchanged edits and rejoined after backup. HTTP redirected with 308 and both sessions upgraded `/ws/v2` with 101. Revocation closed the Editor's live subscription, hid the canvas and returned 403 for snapshot, write, image and the existing ZIP. The Owner retained access. |
| 50-client concentrated reconnect | 100 authenticated WSS sessions shared a single Caddy ingress, with 50 per API replica. After SIGKILL and restart of one replica, all 50 affected sessions subscribed on their first attempt and applied the 13 missed writes. From readiness through catch-up, p95 was **263.24 ms**, with **0 HTTP 429** across upgrades and change requests. The healthy 50 stayed connected. Both replicas and all reconnecting clients agreed on the result. The 14 command receipts and 14 changes include the baseline write. |
| Encrypted restore through Caddy | Verified **623,730 bytes** of ciphertext. Backend write freeze was **40.23 s**, and the HTTPS hold to a confirmed source write was **56.72 s**. B recovered all four file types, versions, Project history, internal links, PNG, ZIP and grants. The restored sessions were cleared and the post-capture revocation was applied. From the maintenance switch through recovery and the first confirmed B write took **19.98 s**. The serving config reload to the confirmed B write took **0.238 s**. |
| Caddy switchback | From entering maintenance on B through verifying A over HTTPS took **7.55 s**. Only one deployment had active writers. B’s accepted edit was reconciled once on A, a repeated command returned the same sequence, and A’s source-only edit and revocation survived. A accepted a further write over HTTPS and its direct and proxy snapshots matched. |

The AMD64 Caddy run used a local CA and loopback clients. The reconnect run used a local Caddy route to assign clients to each replica and added no network delay. Both architectures used synthetic data, a preloaded image and an available recovery identity. The selected native pilot host still needs the real certificate chain, representative clients and shared egress, the production proxy routing, a replica in an independent failure domain, scheduler and alert delivery, and actual cutover and switchback. Record operational RPO and RTO there.

## 5. Inputs needed from the pilot owner

- [ ] **Host and scope:** Host or approved access path, OS and CPU architecture, new install versus existing OpenJam, default Compose versus managed stores, rough dataset size and usable storage. Confirm whether optional Meetings media should be tested.
- [ ] **HTTPS and two clients:** Pilot hostname and DNS/certificate/edge owner, the allowed client networks, and an owner account plus an editor account or permission to create two test accounts. Give a credential location, without posting secrets.
- [ ] **Replica and operations:** Independent storage location and access roles, public age recipients, who can retrieve the recovery key, alert receiver and on-call owner. Confirm the backup windows (default 01:00 and 13:00 UTC), retention policy and the proposed RPO ≤ 24 h / RTO ≤ 30 min.
- [ ] **Change and rollback authority:** Approved pilot and write-freeze window, who can switch and roll back ingress, and the existing deployment and recovery-point references if this is an upgrade.

Keep participant access restricted until the edge, schedule and recovery gates have passed and the operator signs off. XW-151 and XW-152 remain in progress until the real host evidence is recorded.
