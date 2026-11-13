"""Load immutable, versioned workflow guidance from a complete JSON pack."""

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import re
import stat
import threading
from types import MappingProxyType

from proposal import WORKFLOWS, bounded_array, bounded_text, decode_json, require_keys


MAX_PACK_BYTES = 48 * 1024
PACK_VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?")
SKILL_ID = re.compile(r"[a-z][a-z0-9-]{0,47}")
BUILTIN_PATH = Path(__file__).with_name("prompts") / "board.json"


@dataclass(frozen=True)
class Skill:
    id: str
    instructions: str


@dataclass(frozen=True)
class WorkflowGuide:
    instructions: str
    skills: tuple[Skill, ...]


@dataclass(frozen=True)
class PromptPack:
    version: str
    workflows: MappingProxyType

    def guide(self, workflow):
        content = self.workflows[workflow]
        return {
            "version": self.version,
            "instructions": content.instructions,
            "skills": [
                {"id": skill.id, "instructions": skill.instructions}
                for skill in content.skills
            ],
        }


def parse_pack(raw):
    value = require_keys(decode_json(raw.decode("utf-8")), {"schemaVersion", "version", "workflows"})
    if type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1:
        raise ValueError("unsupported prompt pack schema")
    version = bounded_text(value["version"], 40, required=True)
    if not PACK_VERSION.fullmatch(version):
        raise ValueError("invalid prompt pack version")
    workflows = {}
    for name, item in require_keys(value["workflows"], WORKFLOWS).items():
        require_keys(item, {"instructions", "skills"})
        instructions = bounded_text(item["instructions"], 2000, required=True)
        skills = []
        ids = set()
        for candidate in bounded_array(item["skills"], 8):
            require_keys(candidate, {"id", "instructions"})
            ident = bounded_text(candidate["id"], 48, required=True)
            if not SKILL_ID.fullmatch(ident) or ident in ids:
                raise ValueError("invalid or duplicate skill id")
            ids.add(ident)
            skills.append(Skill(ident, bounded_text(candidate["instructions"], 1400, required=True)))
        if not skills:
            raise ValueError("each workflow needs at least one skill")
        workflows[name] = WorkflowGuide(instructions, tuple(skills))
    return PromptPack(version, MappingProxyType(workflows))


def read_pack(path):
    # Limit reads and reject changing or non-regular files. Atomic replacements
    # keep the opened file intact while requests still use the prior snapshot.
    descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_PACK_BYTES:
            raise ValueError("invalid prompt pack file")
        raw = source.read(MAX_PACK_BYTES + 1)
        after = os.fstat(source.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
            after.st_size, after.st_mtime_ns, after.st_ctime_ns,
        ) or len(raw) != before.st_size:
            raise ValueError("prompt pack changed during read")
        return raw


BUILTIN = parse_pack(read_pack(BUILTIN_PATH))


class PromptPacks:
    def __init__(self, path=None):
        self.path = Path(path) if path else None
        self.current = BUILTIN
        self.observed = None
        self.lock = threading.Lock()

    def snapshot(self):
        if self.path is None:
            return BUILTIN
        with self.lock:
            try:
                raw = read_pack(self.path)
                fingerprint = hashlib.sha256(raw).digest()
                if fingerprint != self.observed:
                    self.observed = fingerprint
                    self.current = parse_pack(raw)
            except (OSError, ValueError, RecursionError):
                # A missing or invalid update cannot replace the last good pack.
                pass
            return self.current
