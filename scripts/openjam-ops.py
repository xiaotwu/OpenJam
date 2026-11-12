#!/usr/bin/env python3
"""Local Compose operations for OpenJam's PostgreSQL and SeaweedFS deployment."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import tarfile
from datetime import datetime, timezone
from urllib import error, parse, request

import openjam_offsite

ROOT = Path(__file__).resolve().parent.parent
FORMAT = "openjam-instance-v1"
DUMP = "postgres.dump"
OBJECTS = "seaweedfs.tar"
MANIFEST = "manifest.json"
DB_ENV = ("DATABASE_URL", "MINIO_ENDPOINT", "MINIO_USE_SSL", "MINIO_BUCKET",
          "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY")
PG_PREFIX = 'export PGPASSWORD="$POSTGRES_PASSWORD"; '
PG_OPTIONS = '-h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
SQL_EMPTY = """
SELECT count(*) FROM (
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 1 FROM pg_namespace
  WHERE nspname NOT IN ('public', 'pg_catalog', 'information_schema')
    AND left(nspname, 3) <> 'pg_'
  UNION ALL
  SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
) existing
"""


class OpsError(Exception):
    pass


def call(args, label, **streams):
    result = subprocess.run(args, **streams)
    if result.returncode:
        raise OpsError(f"{label} failed (exit {result.returncode}).")
    return result.stdout


def capture(args, label):
    return call(args, label, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True).strip()


class Compose:
    def __init__(self, project, env_file):
        if not project or not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project):
            raise OpsError("Choose the Compose deployment with --project NAME.")
        self.project = project
        self.args = ["docker", "compose", "--project-directory", str(ROOT),
                     "--project-name", project, "-f", str(ROOT / "docker-compose.yml")]
        if env_file:
            self.args += ["--env-file", str(env_file.resolve())]

    def containers(self):
        ids = capture(["docker", "ps", "-aq", "--filter",
                       f"label=com.docker.compose.project={self.project}"],
                      "Read Compose containers").splitlines()
        if not ids:
            return []
        return json.loads(capture(["docker", "inspect", *ids], "Read container state"))

    def service(self, containers, name, running):
        matches = [c for c in containers if c["Config"]["Labels"].get("com.docker.compose.service") == name
                   and c["Config"]["Labels"].get("com.docker.compose.oneoff", "").lower() != "true"]
        if len(matches) != 1 or matches[0]["State"]["Running"] != running:
            state = "running" if running else "stopped"
            raise OpsError(f"Expected one {state} {name} service in {self.project}.")
        return matches[0]

    def managed_stores(self, *, quiesced=True):
        config = json.loads(capture([*self.args, "config", "--format", "json"], "Read Compose configuration"))
        services = config["services"]
        containers = self.containers()
        postgres = self.service(containers, "postgres", running=True)
        seaweed = self.service(containers, "seaweedfs", running=not quiesced)
        pg_env = container_env(postgres)
        s3_env = container_env(seaweed)
        runtime = services["server"]["environment"]
        try:
            dsn = parse.urlsplit(runtime["DATABASE_URL"])
            managed_db = (dsn.scheme in ("postgres", "postgresql") and dsn.hostname == "postgres"
                          and dsn.port in (None, 5432) and parse.unquote(dsn.path) == "/" + pg_env["POSTGRES_DB"]
                          and parse.unquote(dsn.username or "") == pg_env["POSTGRES_USER"]
                          and parse.unquote(dsn.password or "") == pg_env["POSTGRES_PASSWORD"])
        except (KeyError, ValueError):
            managed_db = False
        if not managed_db:
            raise OpsError("This command requires the deployment's Compose PostgreSQL service.")
        if (runtime.get("MINIO_ENDPOINT") != "seaweedfs:8333" or runtime.get("MINIO_USE_SSL", "false") != "false"
                or runtime.get("MINIO_BUCKET") != s3_env.get("S3_BUCKET")
                or runtime.get("MINIO_ACCESS_KEY") != s3_env.get("AWS_ACCESS_KEY_ID")
                or runtime.get("MINIO_SECRET_KEY") != s3_env.get("AWS_SECRET_ACCESS_KEY")):
            raise OpsError("This command requires the deployment's default SeaweedFS bucket.")
        if runtime.get("REDIS_URL") not in ("redis://redis:6379", "redis://redis:6379/0"):
            raise OpsError("This command requires the deployment's Compose Redis service.")
        for container in containers:
            labels = container["Config"]["Labels"]
            if labels.get("com.docker.compose.service") not in ("server", "worker", "migrate"):
                continue
            if quiesced and container["State"]["Running"]:
                raise OpsError("Stop all OpenJam servers, workers and migrators before this operation.")
            if labels.get("com.docker.compose.service") in ("server", "worker"):
                deployed = container_env(container)
                if any(deployed.get(key) != runtime.get(key) for key in DB_ENV):
                    raise OpsError("The stopped application and the selected Compose configuration use different stores.")
        for container, path in ((postgres, "/var/lib/postgresql/data"), (seaweed, "/data")):
            volumes = [m for m in container["Mounts"] if m["Destination"] == path and m["Type"] == "volume"]
            if len(volumes) != 1:
                raise OpsError("The standard Compose data volumes are required.")
            volume = volumes[0]["Name"]
            labels = json.loads(capture(["docker", "volume", "inspect", volume],
                                        "Read Compose volume ownership"))[0]["Labels"] or {}
            if labels.get("com.docker.compose.project") != self.project:
                raise OpsError("A data volume is outside the selected Compose deployment.")
            if quiesced and container is seaweed and capture(["docker", "ps", "-q", "--filter", f"volume={volume}"],
                                               "Check for active storage mounts"):
                raise OpsError("A running container still mounts the SeaweedFS volume.")
        return postgres, seaweed, runtime["MINIO_BUCKET"]

    def self_check(self, audit, timeout):
        containers = self.containers()
        runtime = {}
        for service in ("server", "worker"):
            matches = [c for c in containers if c["Config"]["Labels"].get("com.docker.compose.service") == service
                       and c["Config"]["Labels"].get("com.docker.compose.oneoff", "").lower() != "true"]
            if not matches or any(not c["State"]["Running"] for c in matches):
                raise OpsError(f"One or more {service} containers are stopped or missing. Run docker compose ps --all.")
            runtime[service] = matches
        if len({c["Image"] for group in runtime.values() for c in group}) != 1:
            raise OpsError("Server and worker do not use the same image.")
        print(f"PASS compose server={len(runtime['server'])} worker={len(runtime['worker'])}", flush=True)
        for server in runtime["server"]:
            args = ["docker", "exec", server["Id"], "openjam", "doctor", "--timeout", timeout]
            if audit:
                args.append("--assets")
            call(args, "OpenJam self-check")


def container_env(container):
    return dict(pair.split("=", 1) for pair in container["Config"]["Env"] if "=" in pair)


def pg_command(postgres, command):
    return ["docker", "exec", "-i", postgres["Id"], "sh", "-ec", PG_PREFIX + command]


def psql(postgres, sql):
    return capture([*pg_command(postgres, 'exec psql -X -qAt -v ON_ERROR_STOP=1 ' + PG_OPTIONS + ' -c "$1"'),
                    "psql", sql], "Read PostgreSQL state")


def schema_version(postgres):
    raw = psql(postgres, "SELECT COALESCE(max(version), 0), count(*) FROM openjam_schema_migrations")
    installed, applied = map(int, raw.split("|"))
    if installed < 1 or installed != applied:
        raise OpsError("The OpenJam migration history is empty or has gaps.")
    return installed


def postgres_major(postgres):
    return int(psql(postgres, "SHOW server_version_num")) // 10000


def checksum(path):
    if path.is_symlink() or not path.is_file():
        raise OpsError(f"Backup file is missing or is a link: {path.name}.")
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as src:
        while chunk := src.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return {"sha256": digest.hexdigest(), "bytes": size}


def scan_tar(path):
    names = set()
    with tarfile.open(path, mode="r|") as archive:
        for item in archive:
            name = PurePosixPath(item.name)
            if (name.is_absolute() or ".." in name.parts or name in names or
                    not (item.isdir() or item.isfile())):
                raise OpsError("The SeaweedFS archive contains an unsupported path or entry.")
            names.add(name)
    if not names:
        raise OpsError("The SeaweedFS archive is empty or unreadable.")


def verify_backup(path):
    manifest = path / MANIFEST
    if manifest.is_symlink() or not manifest.is_file() or manifest.stat().st_size > 16384:
        raise OpsError("The backup manifest is missing or invalid. An incomplete backup cannot be restored.")
    info = json.loads(manifest.read_text())
    if (not isinstance(info, dict) or info.get("format") != FORMAT or
            type(info.get("schema")) is not int or info["schema"] < 1 or
            type(info.get("postgresMajor")) is not int or info["postgresMajor"] < 1 or
            not isinstance(info.get("seaweedImage"), str) or not isinstance(info.get("bucket"), str) or
            not isinstance(info.get("files"), dict) or set(info["files"]) != {DUMP, OBJECTS}):
        raise OpsError("The backup manifest is incompatible.")
    for filename in (DUMP, OBJECTS):
        if checksum(path / filename) != info["files"][filename]:
            raise OpsError(f"Size or SHA-256 mismatch: {filename}.")
    with (path / DUMP).open("rb") as stream:
        if stream.read(5) != b"PGDMP":
            raise OpsError("The PostgreSQL custom archive header is invalid.")
    scan_tar(path / OBJECTS)
    return info


def write_backup_file(args, label, path, limit):
    with path.open("xb") as out:
        if limit is None:
            call(args, label, stdout=out)
            return
        with subprocess.Popen(args, stdout=subprocess.PIPE) as producer:
            try:
                while chunk := producer.stdout.read(1024 * 1024):
                    limit -= len(chunk)
                    if limit < 0:
                        raise OpsError("Backup exceeds the configured size limit. Review capacity before raising it.")
                    out.write(chunk)
                if producer.wait():
                    raise OpsError(f"{label} failed.")
                out.flush()
                os.fsync(out.fileno())
            finally:
                if producer.poll() is None:
                    producer.kill()


def backup(stack, path, *, captured_at=None, max_bytes=None):
    postgres, seaweed, bucket = stack.managed_stores()
    info = {
        "format": FORMAT, "createdAt": (captured_at or datetime.now(timezone.utc)).isoformat(),
        "schema": schema_version(postgres),
        "postgresMajor": postgres_major(postgres), "seaweedImage": seaweed["Config"]["Image"], "bucket": bucket,
    }
    try:
        path.mkdir(mode=0o700)
    except FileExistsError:
        raise OpsError("Choose a new backup directory. Existing backups are never overwritten.") from None
    write_backup_file(pg_command(postgres, "exec pg_dump --format=custom --no-owner --no-privileges " + PG_OPTIONS),
                      "Dump PostgreSQL", path / DUMP, max_bytes)
    remaining = None if max_bytes is None else max_bytes - (path / DUMP).stat().st_size
    write_backup_file(["docker", "cp", seaweed["Id"] + ":/data/.", "-"], "Copy stopped SeaweedFS volume",
                      path / OBJECTS, remaining)
    scan_tar(path / OBJECTS)
    info["files"] = {name: checksum(path / name) for name in (DUMP, OBJECTS)}
    with (path / (MANIFEST + ".partial")).open("x") as out:
        json.dump(info, out, indent=2)
        out.write("\n")
        if max_bytes is not None:
            out.flush()
            os.fsync(out.fileno())
    (path / (MANIFEST + ".partial")).rename(path / MANIFEST)
    if max_bytes is not None:
        openjam_offsite.sync_dir(path)
    print(f"PASS backup schema={info['schema']} postgres={info['postgresMajor']} directory={path}")


def seaweed_empty(container):
    args = ["docker", "cp", container["Id"] + ":/data/.", "-"]
    with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as copy:
        try:
            with tarfile.open(fileobj=copy.stdout, mode="r|") as archive:
                for item in archive:
                    if not item.isdir():
                        return False
            # Drain the tar footer so the producer can finish before wait().
            while copy.stdout.read(8192):
                pass
            if copy.wait():
                raise OpsError("Could not inspect the destination SeaweedFS volume.")
            return True
        finally:
            if copy.poll() is None:
                copy.terminate()


def restore(stack, path):
    info = verify_backup(path)
    postgres, seaweed, bucket = stack.managed_stores()
    if (postgres_major(postgres) != info["postgresMajor"] or
            seaweed["Config"]["Image"] != info["seaweedImage"] or bucket != info["bucket"]):
        raise OpsError("Use the backed-up PostgreSQL major version, SeaweedFS image and bucket name.")
    if psql(postgres, SQL_EMPTY) != "0":
        raise OpsError("The destination PostgreSQL database is not empty.")
    redis = stack.service(stack.containers(), "redis", running=True)
    if capture(["docker", "exec", redis["Id"], "redis-cli", "--raw", "DBSIZE"], "Read Redis state") != "0":
        raise OpsError("The destination Redis database is not empty. Use a fresh deployment.")
    if not seaweed_empty(seaweed):
        raise OpsError("The destination SeaweedFS data volume is not empty.")
    with (path / DUMP).open("rb") as stream:
        call(pg_command(postgres, "exec pg_restore --list"), "Read PostgreSQL backup catalog",
             stdin=stream, stdout=subprocess.DEVNULL)
    with (path / OBJECTS).open("rb") as stream:
        call(["docker", "cp", "-a", "-", seaweed["Id"] + ":/data/"], "Restore SeaweedFS volume", stdin=stream)
    with (path / DUMP).open("rb") as stream:
        call(pg_command(postgres, "exec pg_restore --exit-on-error --single-transaction --no-owner --no-privileges " + PG_OPTIONS),
             "Restore PostgreSQL", stdin=stream)
    installed = schema_version(postgres)
    if installed != info["schema"]:
        raise OpsError("The restored migration version differs from the backup manifest.")
    print(f"PASS restore schema={installed} deployment={stack.project}. Start storage and run the post-restore checks.")


def quick_check(base):
    url = parse.urlsplit(base)
    if (url.scheme not in ("http", "https") or not url.hostname or url.username is not None
            or url.query or url.fragment):
        raise OpsError("Use the HTTP(S) URL of the OpenJam deployment.")
    failed = False
    for path, status in (("livez", "ok"), ("startupz", "started"), ("readyz", "ready"), ("health", "ok")):
        try:
            with request.urlopen(base.rstrip("/") + "/" + path, timeout=5) as response:
                payload = json.loads(response.read(8192))
            if payload.get("status") != status:
                raise ValueError("unexpected status")
            if path == "health" and payload.get("exportsEnabled") is not True:
                print("FAIL /health private storage did not initialize. Run the self-check.")
                failed = True
            else:
                print(f"PASS /{path}")
        except error.HTTPError as exc:
            print(f"FAIL /{path} HTTP {exc.code}")
            failed = True
        except (OSError, ValueError, AttributeError):
            print(f"FAIL /{path} unavailable or unexpected response")
            failed = True
    if failed:
        raise OpsError("OpenJam quick check failed.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("-p", "--project", help="Compose project name")
    parser.add_argument("--env-file", type=Path, help="Compose environment file")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("quick-check", help="check HTTP health and storage initialization").add_argument("url")
    check = sub.add_parser("self-check", help="check running Compose services and their dependencies")
    check.add_argument("--assets", action="store_true", help="read and hash registered private images")
    check.add_argument("--timeout", default="30s", help="doctor timeout per server")
    sub.add_parser("backup", help="back up a quiesced default Compose deployment").add_argument("directory", type=Path)
    sub.add_parser("verify-backup", help="verify a backup directory without Docker").add_argument("directory", type=Path)
    sub.add_parser("restore", help="restore into empty default Compose stores").add_argument("directory", type=Path)
    openjam_offsite.add_commands(sub)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        if args.command == "quick-check":
            quick_check(args.url)
        elif args.command == "verify-backup":
            info = verify_backup(args.directory)
            print(f"PASS backup verification schema={info['schema']} postgres={info['postgresMajor']}")
        elif args.command == "offsite":
            return openjam_offsite.run_command(args, Compose, backup, verify_backup, quick_check, OpsError)
        else:
            stack = Compose(args.project, args.env_file)
            if args.command == "self-check":
                stack.self_check(args.assets, args.timeout)
            elif args.command == "backup":
                backup(stack, args.directory)
            else:
                restore(stack, args.directory)
    except KeyboardInterrupt:
        print("FAIL interrupted. Check the deployment before retrying.", file=sys.stderr)
        return 130
    except (OpsError, openjam_offsite.OffsiteError, OSError, ValueError, KeyError, tarfile.TarError) as exc:
        print(f"FAIL {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
