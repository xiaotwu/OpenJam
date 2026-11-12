# Pilot handoff for openjam-pilot-20261112-rc2

The Linux ARM64 candidate is frozen locally. Follow the [joint pilot checklist](./pilot-acceptance.md) when the pilot host and operating window are available. Meetings media and the external AI profile are off for this candidate.

## 1. Identify and load the candidate

| Item | Locked value |
| --- | --- |
| Runtime source and local Git tag | `ae5686a76ab05c41fdc692e6bb2d346b50684211` / `openjam-pilot-20261112-rc2` |
| Platform and required database schema | `linux/arm64` / `23` |
| Compose image and OCI manifest digest | `openjam-pilot@sha256:2bf16887e48ebc3bc415221d9e08ddf28df7aa9f68793cd5a9faddca4ab9a741` |
| Local Docker tag | `openjam-pilot:20261112-rc2-arm64` |
| OCI configuration digest | `sha256:d3e4c4297c6b010faa08ff11c339d107cf6994c258dfa230bccd628af01b36a1` |
| Offline artifact | `openjam-xw154-linux-arm64.oci.tar`, 91,048,448 bytes |
| Offline artifact SHA-256 | `46a9e00f50d489cc17e0cee00aa73db32b388940e8a2318d566dfd2f2d3e8180` |

The lock at `scripts/pilot-acceptance/rc2.lock.json` records the pinned store images, configuration template hashes and evidence hashes. The local RC2 evidence directory contains the lock, the reconnect and joint rehearsal receipts, the encrypted point receipt and the restored manifest. Collect the exact OCI archive and its checksum from the local XW-154 evidence directory. The runtime tag points to the image source and the worktree contains the updated handoff.

On a Linux ARM64 target, copy the verified files through the approved private channel and run the following from the archive directory.

~~~bash
sha256sum -c openjam-xw154-linux-arm64.oci.tar.sha256 &&
docker image load --input openjam-xw154-linux-arm64.oci.tar

candidate='openjam-pilot@sha256:2bf16887e48ebc3bc415221d9e08ddf28df7aa9f68793cd5a9faddca4ab9a741'
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$candidate")" = linux/arm64 &&
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$candidate")" \
  = ae5686a76ab05c41fdc692e6bb2d346b50684211
~~~

On macOS, use `shasum -a 256 -c` for the first command. Set `OPENJAM_IMAGE` to the digest above. Check `docker compose config --images` and provision the three locked store images before starting with `--no-build --pull never`. The archive contains the application for server, worker and migrate. An AMD64 pilot requires a separately verified AMD64 artifact.

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
| Encrypted capture and receipt | `20261112T223135Z-2b4eb2b5d4d10d6c` at `2026-11-12T22:31:35.429440+00:00` UTC. SHA-256 `f529070707200969e156adcd9f6f495de8e198bcc74a1882b63dda39c5b7621a` |
| Same-schema switchback | RC2, schema 23. Caddy returned to source A after replaying B’s one confirmed write. A’s source-only write and the revoked grant were preserved. |
| Rehearsed source and maintenance Caddy configurations | SHA-256 `6d818f5252574cce91a03d5c433f03e3e352247d683958c79978b7f7eb260c85` / `25cfef4adc931991182987e0041b692f18d29d123946b121d33de6f682a93255` |

The local point is a synthetic record. The drill volumes, archives and temporary keys are cleaned up after verification. The lock at `scripts/pilot-acceptance/rc1.lock.json` identifies the archived earlier candidate. Record the image actually running on the pilot, its schema and a verified pilot recovery point before opening the operating window. For a fresh pilot, record the maintenance fallback and first verified encrypted point.

## 4. What passed locally

| Scope | RC2 evidence |
| --- | --- |
| Concentrated reconnect | With 100 authenticated sessions across two API replicas, 50 affected sessions all rejoined and applied 13 missed changes after the replica restart. Recovery p95 **216.7 ms** from readiness, **0 HTTP 429**, zero lost or duplicate commits. |
| Caddy and collaboration | TLS 1.3 with a local CA, permanent redirect, two Chrome sign-ins and WSS reconnect after the backup. Revocation closed the live subscription. Snapshot, write, image and export returned 403 for the removed editor. |
| Encrypted replica and recovery | 736,101 bytes of verified ciphertext. Source writers paused **12.00 s** and the HTTPS write hold lasted **21.26 s**. B restored Board, Doc, Sheet, Slides, named versions, Project history, the internal link, private PNG, ZIP and grants. |
| Cutover and switchback | After moving recovery to a private `0700` directory, the drill reached the first verified B write in **19.859 s**. From the original signal, including the rejection of the `0755` mount root and the correction, it took **161.795 s**. Switchback to the first confirmed A write took **6.656 s**. Both switches enforced one active writer. |
| 5,000-object browser test | XW-154 used this exact image. All visible images loaded over 20 mixed zoom and edit rounds. Peer-visible p95 was **225.5 ms** with **0** image or sync 429s. |

The local rehearsal used synthetic data, an already available image and recovery identity, and two mounted filesystems on one machine. The pilot schedule, offsite provider, TLS trust and operational RPO/RTO remain to be measured on the target environment.

## 5. Inputs needed from the pilot owner

- [ ] **Host and scope:** Host or approved access path, OS and CPU architecture, new install versus existing OpenJam, default Compose versus managed stores, rough dataset size and usable storage. Confirm whether optional Meetings media should be tested.
- [ ] **HTTPS and two clients:** Pilot hostname and DNS/certificate/edge owner, the allowed client networks, and an owner account plus an editor account or permission to create two test accounts. Give a credential location, without posting secrets.
- [ ] **Replica and operations:** Independent storage location and access roles, public age recipients, who can retrieve the recovery key, alert receiver and on-call owner. Confirm the backup windows (default 01:00 and 13:00 UTC), retention policy and the proposed RPO ≤ 24 h / RTO ≤ 30 min.
- [ ] **Change and rollback authority:** Approved pilot and write-freeze window, who can switch and roll back ingress, and the existing deployment and recovery-point references if this is an upgrade.

Keep participant access restricted until the edge, schedule and recovery gates have passed and the operator signs off. XW-151 and XW-152 remain in progress until the real host evidence is recorded.
