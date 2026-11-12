# Pilot handoff: openjam-pilot-20261112-rc1

**Decision: frozen locally; hold the pilot.** This handoff covers XW-151 and XW-152 on the independent Teams and Projects worktree. Use the [joint pilot checklist](./pilot-acceptance.md) when the host and the operating window are available. Meetings media and the external AI profile are off for this candidate's pilot scope.

## 1. Identify and load the candidate

| Item | Locked value |
| --- | --- |
| Runtime source / local Git tag | `b4639c31ae9712867817fd8a83d6d30bd94a8d1c` / `openjam-pilot-20261112-rc1` |
| Verified joint runbook revision | `002f07031b18bebe36116cd1fd96b49bb4f40a66`; it changed the runbook only, so it did not rebuild the runtime |
| Target platform / required database schema | `linux/arm64` / `23` |
| Compose image reference | `openjam-pilot@sha256:b178a8921ed54e7913e6547e4bdb93a7baa60304f24f73af312db4bacce31b41` |
| OCI manifest / config | `sha256:b178a8921ed54e7913e6547e4bdb93a7baa60304f24f73af312db4bacce31b41` / `sha256:adc7c689e3b6548382c83b1304ee8ed4173f938519cf407e4e48f52fe0c1d782` |
| Offline artifact | `openjam-pilot-linux-arm64.oci.tar`, 91,046,400 bytes |
| Offline artifact SHA-256 | `f772a0c0e3bc4adfaec75f0b4dd91a3274fdfd4723182d8f5775c3cb688fa20b` |

The local bundle contains the OCI archive, its checksum, `rc1.lock.json`, `candidate-smoke.json`, `joint-rehearsal.json` and `earlier-local-evidence.json`. The lock is also checked in at `scripts/pilot-acceptance/rc1.lock.json`. It records the template hashes and pinned store images. Preserve the exact archive; a rebuild from the same commit may have a different digest. Nothing has been uploaded to a registry.

On a Linux ARM64 target, copy the verified files through the approved private channel. From the directory containing the archive and its checksum, run:

~~~bash
sha256sum -c openjam-pilot-linux-arm64.oci.tar.sha256 &&
docker image load --input openjam-pilot-linux-arm64.oci.tar

candidate='openjam-pilot@sha256:b178a8921ed54e7913e6547e4bdb93a7baa60304f24f73af312db4bacce31b41'
test "$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$candidate")" = linux/arm64 &&
test "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$candidate")" \
  = b4639c31ae9712867817fd8a83d6d30bd94a8d1c
~~~

On macOS, use `shasum -a 256 -c` for the first command. In the protected Compose environment, set `OPENJAM_IMAGE` to the digest reference above. Confirm `docker compose config --images` lists that reference and the three default store digests in the lock. Provision those exact store images before starting with `--no-build --pull never`. The offline archive contains the application image used for `server`, `worker` and `migrate`; it does not contain store images. If the host is AMD64, produce and verify a separate AMD64 artifact from the same source before opening the pilot. Do not reuse the ARM64 digest for it.

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

The XW-150 local rollback used schema 14 from `8c3cbb976167253b079f57df37ba7d09ff1bc136` and restored the pre-upgrade backup after testing schema 23. The later joint drill used encrypted point `20261112T081822Z-bb6b8f72b861bcf3` for a same-schema cutover and cutback. Both were synthetic exercises; their receipts are evidence, and their data archives were cleaned up. The pilot recovery point and previous live image remain to be recorded on the host.

## 4. What passed locally

| Scope | Evidence |
| --- | --- |
| **This RC1 digest** | All OCI blobs verified; offline Docker load and a fresh default Compose start by manifest digest passed. Server and worker used the locked image, migration exited successfully, installed and required schema were both 23, and quick check and self-check passed. The empty instance had no private images to audit. |
| **Joint Caddy rehearsal on the same source** | The rehearsal image was `sha256:dd1239dfc898a862b3303ed34cf5f85a4e98d1a82fbc8644547407d58464c224`. Two Chromium sessions verified WSS, bidirectional editing, reconnect and revocation; the four denied paths returned 403. A separate mounted encrypted replica restored Board, Doc, Sheet, Slides, history, links, assets and grants into empty B. Caddy switched A → B → A with one writer, and B's test write was replayed onto A. Reconnect **2.14 s**, edge write hold **24.69 s**, restore through first B write **20.13 s**, and cutback through first A write **8.00 s**. See `joint-rehearsal.json`. |
| **Earlier local operations** | XW-150 passed schema 14 → 23 and rollback. Separate XW-152 drills passed the roughly 1 GiB scale, encrypted restore, and schedule/retention/catch-up/alert behavior with a local receiver. See `earlier-local-evidence.json`. |

The earlier full rehearsal did not run on the new RC1 digest. The new digest passed the local startup checks above; record the digest and run the full pilot checklist against it on the selected host. Small-sample local timings do not establish the pilot RPO or RTO.

## 5. Inputs needed from the pilot owner

- [ ] **Host and scope:** Host or approved access path, OS and CPU architecture, new install versus existing OpenJam, default Compose versus managed stores, rough dataset size and usable storage. Confirm whether optional Meetings media should be tested.
- [ ] **HTTPS and two clients:** Pilot hostname and DNS/certificate/edge owner, the allowed client networks, and an owner account plus an editor account or permission to create two test accounts. Give a credential location, without posting secrets.
- [ ] **Replica and operations:** Independent storage location and access roles, public age recipients, who can retrieve the recovery key, alert receiver and on-call owner. Confirm the backup windows (default 01:00 and 13:00 UTC), retention policy and the proposed RPO ≤ 24 h / RTO ≤ 30 min.
- [ ] **Change and rollback authority:** Approved pilot and write-freeze window, who can switch and roll back ingress, and the existing deployment and recovery-point references if this is an upgrade.

Keep participant access restricted until the edge, schedule and recovery gates have passed and the operator signs off. XW-151 and XW-152 remain in progress until the real host evidence is recorded.
