"""The data contract shared by provider responses and the Go job worker."""

from copy import deepcopy
from dataclasses import dataclass
import json
import re
import unicodedata


WORKFLOWS = {"workshop", "flowchart", "organize"}
MOCK_MODEL = "deterministic-v1"
NODE_ID = re.compile(r"[a-zA-Z][a-zA-Z0-9_-]{0,31}")
MODEL_ID = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._:/@-]{0,127}")


def object_schema(properties):
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


def array_schema(items):
    return {"type": "array", "items": items}


STRING = {"type": "string"}
BOARD_SCHEMA = object_schema({
    "title": STRING,
    "summary": STRING,
    "question": STRING,
    "groups": array_schema(object_schema({
        "title": STRING,
        "items": array_schema(STRING),
    })),
    "nodes": array_schema(object_schema({"id": STRING, "label": STRING})),
    "edges": array_schema(object_schema({"from": STRING, "to": STRING, "label": STRING})),
})


def local_board_schema(generation, finish):
    schema = deepcopy(BOARD_SCHEMA)
    fields = schema["properties"]
    if generation.workflow == "flowchart":
        fields["groups"] = {"const": []}
        fields["nodes"]["maxItems"] = 16
        fields["edges"]["maxItems"] = 24
        if finish:
            fields["nodes"]["minItems"] = 2
    else:
        fields["nodes"] = fields["edges"] = {"const": []}
        fields["groups"]["maxItems"] = 6
        items = fields["groups"]["items"]["properties"]["items"]
        items.update(minItems=1, maxItems=8)
        if finish:
            fields["groups"]["minItems"] = 1
    if finish:
        fields["question"] = {"const": ""}
        fields["title"] = {"type": "string", "minLength": 1}
    return schema


def decode_json(data):
    def unique_keys(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate JSON field")
            result[key] = value
        return result

    def reject_constant(_):
        raise ValueError("invalid JSON number")

    return json.loads(data, object_pairs_hook=unique_keys, parse_constant=reject_constant)


def bounded_text(value, limit, required=False):
    if not isinstance(value, str) or len(value) > limit or any(
        unicodedata.category(char) == "Cc" and char not in "\n\r\t" for char in value
    ):
        raise ValueError("invalid text")
    # Encoding also rejects escaped lone surrogates accepted by json.loads.
    value.encode("utf-8")
    value = value.strip()
    if required and not value:
        raise ValueError("empty text")
    return value


def require_keys(value, keys):
    if not isinstance(value, dict) or value.keys() != set(keys):
        raise ValueError("invalid JSON object")
    return value


def bounded_array(value, limit):
    if not isinstance(value, list) or len(value) > limit:
        raise ValueError("invalid JSON array")
    return value


@dataclass(frozen=True)
class Generation:
    provider: str
    model: str
    workflow: str
    prompt: str
    context: tuple[str, ...]
    answer: str

    @classmethod
    def parse(cls, value):
        required = {"provider", "model", "workflow", "prompt", "context"}
        if not isinstance(value, dict) or not required <= value.keys() or value.keys() - required - {"answer"}:
            raise ValueError("invalid generation request")
        provider = bounded_text(value["provider"], 12, required=True)
        model = bounded_text(value["model"], 128, required=True)
        workflow = bounded_text(value["workflow"], 16, required=True)
        prompt = bounded_text(value["prompt"], 4000, required=True)
        answer = bounded_text(value.get("answer", ""), 1000)
        if provider not in {"openai", "ollama", "mock", "external"} or workflow not in WORKFLOWS:
            raise ValueError("unsupported provider or workflow")
        if not MODEL_ID.fullmatch(model):
            raise ValueError("invalid model identifier")
        ids = set()
        excerpts = []
        for item in bounded_array(value["context"], 12):
            require_keys(item, {"id", "text"})
            ident = bounded_text(item["id"], 1024, required=True)
            if ident in ids:
                raise ValueError("duplicate context")
            ids.add(ident)
            excerpts.append(bounded_text(item["text"], 1200, required=True))
        if sum(map(len, excerpts)) > 6000:
            raise ValueError("context exceeds the limit")
        return cls(provider, model, workflow, prompt, tuple(excerpts), answer)

    def model_input(self, guide):
        # The provider only needs excerpts. The application keeps the selected
        # object identifiers so it can recheck revisions before applying.
        return json.dumps({
            "request": self.prompt,
            "workflow": self.workflow,
            "excerpts": self.context,
            "clarificationAnswer": self.answer,
            "workflowGuide": guide,
        }, ensure_ascii=False, separators=(",", ":"))


def validate_proposal(value, generation):
    require_keys(value, BOARD_SCHEMA["properties"])
    question = bounded_text(value["question"], 280)
    title = bounded_text(value["title"], 100, required=not question)
    summary = bounded_text(value["summary"], 500)
    groups = bounded_array(value["groups"], 6)
    nodes = bounded_array(value["nodes"], 16)
    edges = bounded_array(value["edges"], 24)
    clean = {"title": title, "summary": summary, "question": question, "groups": [], "nodes": [], "edges": []}

    if question:
        if generation.answer or groups or nodes or edges:
            raise ValueError("invalid clarification")
        return clean

    if generation.workflow == "flowchart":
        if groups or len(nodes) < 2:
            raise ValueError("a flowchart needs at least two nodes")
        ids = set()
        for node in nodes:
            require_keys(node, {"id", "label"})
            ident = bounded_text(node["id"], 32, required=True)
            if not NODE_ID.fullmatch(ident) or ident in ids:
                raise ValueError("invalid node identifier")
            ids.add(ident)
            clean["nodes"].append({"id": ident, "label": bounded_text(node["label"], 180, required=True)})
        pairs = set()
        for edge in edges:
            require_keys(edge, {"from", "to", "label"})
            start = bounded_text(edge["from"], 32, required=True)
            end = bounded_text(edge["to"], 32, required=True)
            pair = (start, end)
            if start == end or start not in ids or end not in ids or pair in pairs:
                raise ValueError("invalid flow edge")
            pairs.add(pair)
            clean["edges"].append({"from": start, "to": end, "label": bounded_text(edge["label"], 80)})
        return clean

    if not groups or nodes or edges:
        raise ValueError("workshop and organize proposals require groups")
    item_count = 0
    for group in groups:
        require_keys(group, {"title", "items"})
        items = [
            bounded_text(item, 280, required=True)
            for item in bounded_array(group["items"], 8)
        ]
        if not items:
            raise ValueError("empty group")
        item_count += len(items)
        clean["groups"].append({
            "title": bounded_text(group["title"], 80, required=True),
            "items": items,
        })
    if item_count > 32:
        raise ValueError("too many group items")
    return clean
