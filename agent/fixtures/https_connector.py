"""Synthetic external Agent endpoint for local HTTPS acceptance tests."""

import argparse
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import ssl
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from deterministic import generate_mock
from proposal import BOARD_SCHEMA, Generation, decode_json, validate_proposal


MAX_BODY = 128 * 1024
REQUEST_FIELDS = {"version", "model", "workflow", "prompt", "context", "policy", "workflowGuide", "proposalSchema"}
MARKDOWN = "## External connector receipt\n\n- The local HTTPS fixture prepared this board draft."


def reply(value):
    if (
        not isinstance(value, dict) or not REQUEST_FIELDS <= value.keys()
        or value.keys() - REQUEST_FIELDS - {"answer"}
        or type(value["version"]) is not int or value["version"] != 1
        or not isinstance(value["policy"], str) or not isinstance(value["workflowGuide"], dict)
        or value["proposalSchema"] != BOARD_SCHEMA
        or not isinstance(value["context"], list) or len(value["context"]) > 12
    ):
        raise ValueError("invalid connector request")
    request = Generation.parse({
        "provider": "external", "model": value["model"], "workflow": value["workflow"],
        "prompt": value["prompt"], "answer": value.get("answer", ""),
        "context": [{"id": str(index), "text": item} for index, item in enumerate(value["context"])],
    })
    return {"version": 1, "proposal": validate_proposal(generate_mock(request), request), "markdown": MARKDOWN}


class FixtureServer(ThreadingHTTPServer):
    def __init__(self, address, tls, token):
        self.tls = tls
        self.token = token
        super().__init__(address, FixtureHandler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(10)
        try:
            return self.tls.wrap_socket(connection, server_side=True, do_handshake_on_connect=False), address
        except OSError:
            connection.close()
            raise

    def handle_error(self, *_):
        pass


class FixtureHandler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def respond(self, status, result):
        body = json.dumps(result, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/openjam/generate":
            self.respond(404, {"error": "route not found"})
            return
        authorization = self.headers.get_all("Authorization") or []
        if len(authorization) != 1 or not hmac.compare_digest(authorization[0].encode("latin-1"), self.server.token):
            self.respond(401, {"error": "unauthenticated"})
            return
        lengths = self.headers.get_all("Content-Length") or []
        if (
            self.headers.get("Transfer-Encoding") is not None or len(lengths) != 1
            or not lengths[0].isascii() or not lengths[0].isdecimal() or len(lengths[0]) > 6
            or not 1 <= int(lengths[0]) <= MAX_BODY
            or self.headers.get_content_type() != "application/json"
        ):
            self.respond(400, {"error": "invalid request body"})
            return
        try:
            length = int(lengths[0])
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError("incomplete request")
            result = reply(decode_json(body.decode("utf-8")))
        except (OSError, ValueError, RecursionError):
            self.respond(400, {"error": "invalid connector request"})
            return
        self.respond(200, result)


def main():
    arguments = argparse.ArgumentParser(description=__doc__)
    arguments.add_argument("--certificate", required=True)
    arguments.add_argument("--key", required=True)
    arguments.add_argument("--host", default="127.0.0.1")
    arguments.add_argument("--port", type=int, default=8443)
    args = arguments.parse_args()
    token = os.environ.get("OPENJAM_EXTERNAL_AGENT_TOKEN", "")
    if not token or not token.isascii() or not token.isprintable() or any(char.isspace() for char in token):
        arguments.error("set OPENJAM_EXTERNAL_AGENT_TOKEN to a synthetic bearer token")
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(args.certificate, args.key)
    with FixtureServer((args.host, args.port), tls, ("Bearer " + token).encode("ascii")) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
