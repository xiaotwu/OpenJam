import json
from pathlib import Path
import socket
from tempfile import TemporaryDirectory
import time
import unittest
from unittest.mock import patch

from fixtures.https_connector import MARKDOWN, reply
from prompt_packs import BUILTIN_PATH, MAX_PACK_BYTES, PromptPacks
from proposal import BOARD_SCHEMA, Generation
from providers import (
    MAX_EXTERNAL_RESPONSE, MAX_PROVIDER_REQUEST, SYSTEM_PROMPT, Config, InvalidOutput,
    ProviderError, TransportFailure, UnsafeEndpoint, exchange, generate, parse_external_url, resolve,
)
from test_agent import FIXTURE_MODEL, FIXTURE_TOKEN, request_data, valid_proposal


EXTERNAL_TOKEN = "synthetic-external-secret"
EXTERNAL_LABEL = "Workspace assistant"
EXTERNAL_URL = "https://adapter.example:8443/shiori/generate"
EXTERNAL_ENV = {
    "SHIORI_AGENT_TOKEN": FIXTURE_TOKEN,
    "SHIORI_EXTERNAL_AGENT_MODEL": FIXTURE_MODEL,
    "SHIORI_EXTERNAL_AGENT_URL": EXTERNAL_URL,
    "SHIORI_EXTERNAL_AGENT_TOKEN": EXTERNAL_TOKEN,
    "SHIORI_EXTERNAL_AGENT_LABEL": EXTERNAL_LABEL,
}


class ConnectorTests(unittest.TestCase):
    def test_fixed_connector_contract_and_minimal_context(self):
        config = Config.from_env(EXTERNAL_ENV)
        request = Generation.parse(request_data("external", answer="Focus on decisions"))
        calls = []

        def transport(endpoint, body, headers, _deadline):
            calls.append(endpoint)
            self.assertTrue(endpoint.https)
            self.assertEqual((endpoint.host, endpoint.port, endpoint.path), ("adapter.example", 8443, "/shiori/generate"))
            self.assertEqual(headers, {"Authorization": "Bearer " + EXTERNAL_TOKEN})
            self.assertEqual(body["version"], 1)
            self.assertEqual(body["context"], ["Review requirements before shipping"])
            self.assertEqual(body["answer"], "Focus on decisions")
            self.assertEqual(body["proposalSchema"], BOARD_SCHEMA)
            self.assertEqual(body["policy"], SYSTEM_PROMPT)
            self.assertTrue(body["workflowGuide"]["skills"])
            self.assertNotIn("local-note", json.dumps(body))
            self.assertNotIn(FIXTURE_TOKEN, json.dumps((body, headers)))
            self.assertNotIn(EXTERNAL_TOKEN, json.dumps(body))
            return 200, json.dumps({**reply(body), "usage": {"inputTokens": 19}}).encode("utf-8")

        result = generate(config, request, transport)
        self.assertEqual(len(calls), 1)
        self.assertEqual(result["externalReply"], {"source": EXTERNAL_LABEL, "markdown": MARKDOWN})
        self.assertEqual(result["usage"], {"inputTokens": 19})
        self.assertEqual(result["proposal"]["groups"][0]["items"][0], "Focus on decisions")
        self.assertNotIn(EXTERNAL_TOKEN, repr(config))
        self.assertNotIn(FIXTURE_TOKEN, repr(config))

    def test_rejects_invalid_connector_output_without_retry(self):
        config = Config.from_env(EXTERNAL_ENV)
        request = Generation.parse(request_data("external"))
        good = {"version": 1, "proposal": valid_proposal()}
        cases = (
            (200, {**good, "version": True}),
            (200, {**good, "source": "connector-controlled label"}),
            (200, {**good, "markdown": "文字" * 2001}),
            (200, {**good, "markdown": "bad\0reply"}),
            (200, {**good, "markdown": None}),
            (200, {**good, "usage": {"outputTokens": True}}),
            (200, {**good, "usage": {"outputTokens": 10_000_001}}),
            (200, {**good, "proposal": {**valid_proposal(), "groups": []}}),
            (201, good),
            (200, json.dumps(good).encode("utf-16")),
            (200, b"x" * (MAX_EXTERNAL_RESPONSE + 1)),
        )
        for status, value in cases:
            with self.subTest(status=status, variant=str(value)[:90]):
                calls = []

                def transport(*_):
                    calls.append(1)
                    return status, value if isinstance(value, bytes) else json.dumps(value).encode("utf-8")

                with self.assertRaises(ProviderError) as fault:
                    generate(config, request, transport)
                self.assertEqual(fault.exception.code, "INVALID_MODEL_OUTPUT")
                self.assertEqual(len(calls), 1)

        result = generate(config, request, lambda *_: (200, json.dumps({**good, "markdown": " "}).encode("utf-8")))
        self.assertEqual(result, {"proposal": valid_proposal()})
        with self.assertRaises(InvalidOutput):
            exchange(config.external_endpoint, {"prompt": "x" * MAX_PROVIDER_REQUEST}, {}, time.monotonic() + 1)

    def test_unknown_cloud_result_and_redirect_are_not_retried(self):
        config = Config.from_env(EXTERNAL_ENV)
        request = Generation.parse(request_data("external"))
        calls = []

        def disconnected(*_):
            calls.append(1)
            raise TransportFailure(sent=True, timed_out=True)

        with self.assertRaises(ProviderError) as fault:
            generate(config, request, disconnected)
        self.assertEqual(fault.exception.code, "PROVIDER_OUTCOME_UNKNOWN")
        self.assertFalse(fault.exception.retryable)
        self.assertEqual(calls, [1])

        for status, code in ((307, "PROVIDER_REJECTED"), (429, "PROVIDER_RATE_LIMIT"), (503, "PROVIDER_UNAVAILABLE")):
            with self.subTest(status=status), self.assertRaises(ProviderError) as fault:
                generate(config, request, lambda *_: (status, b"https://other.example/private"))
            self.assertEqual(fault.exception.code, code)
            self.assertFalse(fault.exception.retryable)
            self.assertNotIn("other.example", str(fault.exception))

    def test_connector_config_is_explicit_and_https_only(self):
        for invalid in (
            "http://adapter.example/shiori/generate", "https://user@adapter.example/generate",
            "https://adapter.example/generate?x=1", "https://adapter.example/generate#x",
            "https://adapter.example//other", "https://169.254.169.254/generate", "https://224.0.0.1/",
            "\x00https://adapter.example/generate",
        ):
            with self.subTest(invalid=invalid), self.assertRaises(UnsafeEndpoint):
                parse_external_url(invalid)
        with self.assertRaises(ValueError):
            Config.from_env({**EXTERNAL_ENV, "SHIORI_EXTERNAL_AGENT_TOKEN": ""})
        with self.assertRaises(ValueError):
            Config.from_env({**EXTERNAL_ENV, "SHIORI_EXTERNAL_AGENT_LABEL": "First\nSecond"})

        endpoint = parse_external_url(EXTERNAL_URL)
        records = [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("127.0.0.1", 8443)),
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("169.254.169.254", 8443)),
        ]
        with patch("providers.socket.getaddrinfo", return_value=records), self.assertRaises(UnsafeEndpoint):
            resolve(endpoint, time.monotonic() + 1)

        for config, model in ((Config(token=FIXTURE_TOKEN), FIXTURE_MODEL), (Config.from_env(EXTERNAL_ENV), "other-model")):
            with self.assertRaises(ProviderError) as fault:
                generate(config, Generation.parse(request_data("external", model=model)))
            self.assertEqual(fault.exception.code, "PROVIDER_NOT_CONFIGURED")


class PromptPackTests(unittest.TestCase):
    def test_explicit_legacy_builtin_path_is_loaded(self):
        previous = BUILTIN_PATH.with_name("board-v1.json")
        packs = PromptPacks(previous)
        self.assertEqual(previous.read_bytes(), BUILTIN_PATH.read_bytes())
        self.assertIsNot(packs.snapshot(), PromptPacks().snapshot())

    def test_complete_pack_is_adopted_atomically_and_invalid_updates_are_ignored(self):
        initial = json.loads(BUILTIN_PATH.read_text(encoding="utf-8"))
        with TemporaryDirectory(prefix="shiori-prompt-pack-") as directory:
            path = Path(directory) / "board.json"
            packs = PromptPacks(path)
            builtin = packs.snapshot()
            self.assertEqual(builtin.version, "1.0.0")
            path.write_text(json.dumps({**initial, "version": "2.0.0"}), encoding="utf-8")
            stable = packs.snapshot()
            self.assertEqual(stable.version, "2.0.0")

            incomplete = {**initial, "version": "3.0.0", "workflows": {"workshop": initial["workflows"]["workshop"]}}
            for invalid in (b"{", json.dumps(incomplete).encode("utf-8"), b"x" * (MAX_PACK_BYTES + 1)):
                path.write_bytes(invalid)
                self.assertIs(packs.snapshot(), stable)
            path.unlink()
            self.assertIs(packs.snapshot(), stable)

            replacement = path.with_suffix(".new")
            next_pack = {**initial, "version": "3.0.0"}
            next_pack["workflows"]["workshop"]["instructions"] = "Put the desired outcome first."
            replacement.write_text(json.dumps(next_pack), encoding="utf-8")
            replacement.replace(path)
            self.assertEqual(packs.snapshot().guide("workshop")["instructions"], "Put the desired outcome first.")
            self.assertEqual(stable.guide("workshop")["version"], "2.0.0")
            self.assertNotEqual(stable.guide("workshop")["instructions"], packs.snapshot().guide("workshop")["instructions"])

    def test_loaded_guide_can_shape_content_but_cannot_replace_system_policy(self):
        pack = json.loads(BUILTIN_PATH.read_text(encoding="utf-8"))
        pack["version"] = "1.1.0-test"
        pack["workflows"]["workshop"]["instructions"] = "Custom grouping guidance."
        with TemporaryDirectory(prefix="shiori-prompt-policy-") as directory:
            path = Path(directory) / "board.json"
            path.write_text(json.dumps(pack), encoding="utf-8")
            config = Config.from_env({**EXTERNAL_ENV, "SHIORI_AGENT_PROMPT_PACK": str(path)})
            request = Generation.parse(request_data("external"))

            def transport(_endpoint, body, _headers, _deadline):
                self.assertEqual(body["policy"], SYSTEM_PROMPT)
                self.assertEqual(body["workflowGuide"]["version"], "1.1.0-test")
                self.assertEqual(body["workflowGuide"]["instructions"], "Custom grouping guidance.")
                self.assertEqual(body["proposalSchema"], BOARD_SCHEMA)
                return 200, json.dumps(reply(body)).encode("utf-8")

            result = generate(config, request, transport)
            self.assertEqual(result["externalReply"]["markdown"], MARKDOWN)


if __name__ == "__main__":
    unittest.main()
