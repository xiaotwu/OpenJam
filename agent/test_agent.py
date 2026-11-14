import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import socket
import threading
import time
import unittest
from unittest.mock import patch

from proposal import BOARD_SCHEMA, Generation, MOCK_MODEL, validate_proposal
from providers import (
    OPENAI_ENDPOINT, Config, ProviderError, TransportFailure, UnsafeEndpoint,
    generate, parse_ollama_url, resolve,
)
from service import AgentServer, MAX_REQUEST_BYTES


FIXTURE_TOKEN = "shiori-agent-fixture-token"
FIXTURE_KEY = "synthetic-key-for-unit-test"
FIXTURE_MODEL = "structured-model-fixture"


def request_data(provider="mock", workflow="workshop", **overrides):
    value = {
        "provider": provider,
        "model": MOCK_MODEL if provider == "mock" else FIXTURE_MODEL,
        "workflow": workflow,
        "prompt": "Plan a workshop about release handoffs",
        "context": [{"id": "local-note", "text": "Review requirements before shipping"}],
    }
    value.update(overrides)
    return value


def valid_proposal():
    return {
        "title": "Release review",
        "summary": "Coordinate the release handoff",
        "question": "",
        "groups": [{"title": "Preparation", "items": ["Review requirements"]}],
        "nodes": [],
        "edges": [],
    }


def openai_body(text, input_count=20, output_count=10, kind="output_text"):
    return json.dumps({
        "status": "completed",
        "output": [
            {"type": "reasoning", "summary": []},
            {"type": "message", "role": "assistant", "content": [{"type": kind, "text": text}]},
        ],
        "usage": {"input_tokens": input_count, "output_tokens": output_count},
    }).encode()


class AdapterTests(unittest.TestCase):
    def test_openai_responses_uses_strict_schema_and_repairs_once(self):
        config = Config(token=FIXTURE_TOKEN, openai_key=FIXTURE_KEY, openai_model=FIXTURE_MODEL)
        request = Generation.parse(request_data("openai"))
        calls = []

        def synthetic(endpoint, body, headers, deadline):
            calls.append((endpoint, body, headers, deadline))
            if len(calls) == 1:
                return 200, openai_body('{"unsafe":"unvalidated output marker"}')
            return 200, openai_body(json.dumps(valid_proposal()), 21, 11)

        result = generate(config, request, synthetic)
        self.assertEqual(result["proposal"], valid_proposal())
        self.assertEqual(result["usage"], {"inputTokens": 41, "outputTokens": 21})
        self.assertEqual(len(calls), 2)
        for endpoint, body, headers, deadline in calls:
            self.assertEqual(endpoint, OPENAI_ENDPOINT)
            self.assertEqual(headers, {"Authorization": "Bearer " + FIXTURE_KEY})
            self.assertFalse(body["store"])
            self.assertEqual(body["text"]["format"], {
                "type": "json_schema", "name": "shiori_board_proposal", "schema": BOARD_SCHEMA, "strict": True,
            })
            self.assertNotIn("tools", body)
            self.assertNotIn("local-note", body["input"])
            self.assertIn("Review requirements before shipping", body["input"])
            self.assertNotIn("unvalidated output marker", json.dumps(body))
            self.assertEqual(deadline, calls[0][3])
        self.assertNotEqual(calls[0][1]["instructions"], calls[1][1]["instructions"])

    def test_cloud_ambiguous_response_stops_without_automatic_retry(self):
        config = Config(token=FIXTURE_TOKEN, openai_key=FIXTURE_KEY, openai_model=FIXTURE_MODEL)
        request = Generation.parse(request_data("openai"))
        calls = []

        def timeout_after_dispatch(*_):
            calls.append(1)
            raise TransportFailure(sent=True, timed_out=True)

        with self.assertRaises(ProviderError) as result:
            generate(config, request, timeout_after_dispatch)
        self.assertEqual(result.exception.code, "PROVIDER_OUTCOME_UNKNOWN")
        self.assertFalse(result.exception.retryable)
        self.assertEqual(len(calls), 1)

    def test_provider_refusal_and_rate_limit_have_distinct_outcomes(self):
        config = Config(token=FIXTURE_TOKEN, openai_key=FIXTURE_KEY, openai_model=FIXTURE_MODEL)
        request = Generation.parse(request_data("openai"))
        for status, body, code, retryable in (
            (429, b"private response", "PROVIDER_RATE_LIMIT", True),
            (200, openai_body("private response", kind="refusal"), "PROVIDER_REFUSAL", False),
        ):
            with self.subTest(code=code):
                with self.assertRaises(ProviderError) as result:
                    generate(config, request, lambda *_: (status, body))
                self.assertEqual(result.exception.code, code)
                self.assertEqual(result.exception.retryable, retryable)
                self.assertNotIn("private response", json.dumps(result.exception.response()))

    def test_ollama_uses_chat_schema_and_usage(self):
        endpoint = parse_ollama_url("http://ollama:11434")
        config = Config(token=FIXTURE_TOKEN, ollama_model=FIXTURE_MODEL, ollama_endpoint=endpoint)
        request = Generation.parse(request_data("ollama"))

        def synthetic(actual_endpoint, body, headers, _):
            self.assertEqual(actual_endpoint, endpoint)
            self.assertEqual(endpoint.path, "/api/chat")
            self.assertEqual(body["format"]["properties"]["nodes"], {"const": []})
            self.assertEqual(body["format"]["properties"]["edges"], {"const": []})
            self.assertFalse(body["stream"])
            self.assertEqual(body["options"]["temperature"], 0)
            self.assertEqual(headers, {})
            self.assertNotIn("tools", body)
            return 200, json.dumps({
                "done": True, "message": {"content": json.dumps(valid_proposal())},
                "prompt_eval_count": 14, "eval_count": 12,
            }).encode()

        self.assertEqual(generate(config, request, synthetic), {
            "proposal": valid_proposal(), "usage": {"inputTokens": 14, "outputTokens": 12},
        })

    def test_ollama_repair_constrains_mixed_clarification_and_draft(self):
        config = Config(token=FIXTURE_TOKEN, ollama_model=FIXTURE_MODEL, ollama_endpoint=parse_ollama_url("http://ollama:11434"))
        request = Generation.parse(request_data("ollama"))
        calls = []

        def synthetic(_endpoint, body, _headers, _deadline):
            calls.append(body["format"]["properties"])
            proposal = valid_proposal()
            if len(calls) == 1:
                proposal["question"] = "Is this enough?"
            return 200, json.dumps({"done": True, "message": {"content": json.dumps(proposal)}}).encode()

        self.assertEqual(generate(config, request, synthetic)["proposal"], valid_proposal())
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1]["question"], {"const": ""})
        self.assertEqual(calls[1]["groups"]["minItems"], 1)

    def test_ollama_requires_configured_local_destination(self):
        for address in (
            "http://8.8.8.8:11434", "http://169.254.169.254:11434",
            "http://user@localhost:11434", "http://localhost:11434/custom",
            "http://localhost:11434?redirect=1",
        ):
            with self.subTest(address=address), self.assertRaises(UnsafeEndpoint):
                parse_ollama_url(address)

        endpoint = parse_ollama_url("http://ollama:11434")
        records = [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("127.0.0.1", 11434)),
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("8.8.8.8", 11434)),
        ]
        with patch("providers.socket.getaddrinfo", return_value=records), self.assertRaises(UnsafeEndpoint):
            resolve(endpoint, time.monotonic() + 1)

    def test_mock_is_disabled_by_default_and_outputs_valid_deterministic_drafts(self):
        request = Generation.parse(request_data())
        with self.assertRaises(ProviderError) as result:
            generate(Config(token=FIXTURE_TOKEN), request)
        self.assertEqual(result.exception.code, "PROVIDER_NOT_CONFIGURED")

        config = Config(token=FIXTURE_TOKEN, mock_enabled=True)
        for workflow, prompt in (
            ("workshop", "给项目团队做一个发布回顾工作坊"),
            ("flowchart", "需求评审 → 实现 → 测试 → 发布"),
            ("organize", "Organize the selected release notes"),
        ):
            request = Generation.parse(request_data(workflow=workflow, prompt=prompt))
            first = generate(config, request)
            self.assertEqual(generate(config, request), first)
            self.assertEqual(validate_proposal(first["proposal"], request), first["proposal"])

    def test_mock_clarification_resumes_once(self):
        config = Config(token=FIXTURE_TOKEN, mock_enabled=True)
        content = request_data(prompt="Clarify the focus of this workshop")
        result = generate(config, Generation.parse(content))["proposal"]
        self.assertTrue(result["question"])
        self.assertEqual(result["groups"], [])
        resumed = generate(config, Generation.parse({**content, "answer": "Decide whether to ship the update"}))["proposal"]
        self.assertEqual(resumed["question"], "")
        self.assertIn("Decide whether to ship the update", resumed["groups"][0]["items"])

    def test_generation_rejects_invalid_graph_and_repeated_question(self):
        request = Generation.parse(request_data(workflow="flowchart"))
        invalid = {
            "title": "Bad edge", "summary": "", "question": "", "groups": [],
            "nodes": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}],
            "edges": [{"from": "a", "to": "missing", "label": ""}],
        }
        with self.assertRaises(ValueError):
            validate_proposal(invalid, request)

        response = {**valid_proposal(), "question": "One more question?", "groups": []}
        answered = Generation.parse(request_data(answer="The scope is clear"))
        with self.assertRaises(ValueError):
            validate_proposal(response, answered)


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.server = AgentServer(("127.0.0.1", 0), Config(token=FIXTURE_TOKEN, mock_enabled=True))
        thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def call(self, method, path, body=None, auth=True, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        defaults = {"Content-Type": "application/json"}
        if auth:
            defaults["Authorization"] = "Bearer " + FIXTURE_TOKEN
        try:
            connection.request(method, path, body, {**defaults, **(headers or {})})
            response = connection.getresponse()
            return response.status, json.load(response), response.getheader("Cache-Control")
        finally:
            connection.close()

    def test_health_and_internal_auth(self):
        self.assertEqual(self.call("GET", "/healthz", auth=False), (200, {"status": "ready"}, "no-store"))
        status, body, _ = self.call("POST", "/generate", "{}", auth=False)
        self.assertEqual(status, 401)
        self.assertEqual(body["code"], "UNAUTHENTICATED")
        status, body, _ = self.call("POST", "/generate", json.dumps(request_data()))
        self.assertEqual(status, 200)
        self.assertTrue(body["proposal"]["groups"])

    def test_oversized_and_invalid_input_are_rejected(self):
        status, body, _ = self.call("POST", "/generate", headers={"Content-Length": str(MAX_REQUEST_BYTES + 1)})
        self.assertEqual(status, 413)
        self.assertEqual(body["code"], "REQUEST_TOO_LARGE")
        status, body, _ = self.call("POST", "/generate", '{"prompt":"bad","prompt":"duplicate"}')
        self.assertEqual(status, 400)
        self.assertEqual(body["code"], "INVALID_GENERATION_REQUEST")


class LocalTransportTests(unittest.TestCase):
    def test_ollama_redirect_is_never_followed(self):
        paths = []

        class RedirectingModel(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                paths.append(self.path)
                self.send_response(307)
                self.send_header("Location", "/other-service")
                self.send_header("Content-Length", "0")
                self.end_headers()

        with ThreadingHTTPServer(("127.0.0.1", 0), RedirectingModel) as server:
            worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
            worker.start()
            endpoint = parse_ollama_url(f"http://127.0.0.1:{server.server_port}")
            config = Config(token=FIXTURE_TOKEN, ollama_model=FIXTURE_MODEL, ollama_endpoint=endpoint)
            try:
                with self.assertRaises(ProviderError) as result:
                    generate(config, Generation.parse(request_data("ollama")))
                self.assertEqual(result.exception.code, "PROVIDER_REJECTED")
                self.assertEqual(paths, ["/api/chat"])
            finally:
                server.shutdown()
                worker.join(2)

    def test_transport_enforces_wall_clock_deadline(self):
        class SlowModel(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_):
                pass

            def do_POST(self):
                self.rfile.read(int(self.headers["Content-Length"]))
                self.send_response(200)
                self.send_header("Content-Length", "100")
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                for _ in range(100):
                    try:
                        self.wfile.write(b" ")
                        self.wfile.flush()
                    except OSError:
                        return
                    time.sleep(0.06)

        with ThreadingHTTPServer(("127.0.0.1", 0), SlowModel) as server:
            worker = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
            worker.start()
            endpoint = parse_ollama_url(f"http://127.0.0.1:{server.server_port}")
            config = Config(
                token=FIXTURE_TOKEN, ollama_model=FIXTURE_MODEL, ollama_endpoint=endpoint, timeout=0.35,
            )
            try:
                start = time.monotonic()
                with self.assertRaises(ProviderError) as result:
                    generate(config, Generation.parse(request_data("ollama")))
                self.assertEqual(result.exception.code, "PROVIDER_TIMEOUT")
                self.assertTrue(result.exception.retryable)
                self.assertLess(time.monotonic() - start, 1.2)
            finally:
                server.shutdown()
                worker.join(2)


if __name__ == "__main__":
    unittest.main()
