"""Internal Shiori provider service."""

import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import socket
import sys
import threading

from proposal import Generation, decode_json
from providers import Config, ProviderError, exchange, generate


MAX_REQUEST_BYTES = 128 * 1024
BUSY_BODY = b'{"code":"AGENT_BUSY","error":"The model service is busy.","retryable":true}'


class AgentServer(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 16

    def __init__(self, address, config, transport=exchange):
        self.config = config
        self.transport = transport
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(address, AgentHandler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(10)
        return connection, address

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            try:
                request.settimeout(1)
                request.sendall(
                    b"HTTP/1.1 503 Service Unavailable\r\n"
                    b"Content-Type: application/json\r\nCache-Control: no-store\r\nConnection: close\r\n"
                    + f"Content-Length: {len(BUSY_BODY)}\r\n\r\n".encode("ascii")
                    + BUSY_BODY
                )
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()

    def handle_error(self, request, address):
        # Do not log HTTP request lines, content, provider output or headers.
        pass


class AgentHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Shiori-Agent"
    sys_version = ""

    def log_message(self, *_):
        pass

    def send_error(self, code, message=None, explain=None):
        self.send_json(code, {"code": "INVALID_HTTP_REQUEST", "error": "Invalid model service request.", "retryable": False})

    def send_json(self, status, result):
        body = json.dumps(result, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.close_connection = True
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def fail(self, status, code, message, *, retryable=False):
        self.send_json(status, {"code": code, "error": message, "retryable": retryable})

    def do_GET(self):
        if self.path == "/healthz":
            self.send_json(200, {"status": "ready"})
        else:
            self.fail(404, "NOT_FOUND", "Model service route not found.")

    def authenticated(self):
        headers = self.headers.get_all("Authorization") or []
        if len(headers) != 1:
            return False
        scheme, _, token = headers[0].partition(" ")
        return scheme.lower() == "bearer" and hmac.compare_digest(
            token.encode("latin-1"), self.server.config.token.encode("ascii"),
        )

    def read_generation(self):
        length_headers = self.headers.get_all("Content-Length") or []
        if len(length_headers) != 1 or self.headers.get("Transfer-Encoding") is not None:
            raise ProviderError(400, "INVALID_GENERATION_REQUEST", "Provide a bounded JSON request body.")
        length_text = length_headers[0]
        if not length_text.isdecimal() or len(length_text) > 10:
            raise ProviderError(400, "INVALID_GENERATION_REQUEST", "Invalid request length.")
        length = int(length_text)
        if length > MAX_REQUEST_BYTES:
            raise ProviderError(413, "REQUEST_TOO_LARGE", "The model request exceeds the size limit.")
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            raise ProviderError(415, "INVALID_GENERATION_REQUEST", "Provide a JSON request body.")
        try:
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError("incomplete request")
            return Generation.parse(decode_json(body.decode("utf-8")))
        except (ValueError, RecursionError, socket.timeout) as exc:
            raise ProviderError(400, "INVALID_GENERATION_REQUEST", "Invalid model generation input.") from exc

    def do_POST(self):
        if self.path != "/generate":
            self.fail(404, "NOT_FOUND", "Model service route not found.")
            return
        if not self.authenticated():
            self.fail(401, "UNAUTHENTICATED", "An internal model service token is required.")
            return
        try:
            request = self.read_generation()
            result = generate(self.server.config, request, self.server.transport)
        except ProviderError as exc:
            self.send_json(exc.status, exc.response())
            return
        except Exception:
            self.fail(500, "AGENT_ERROR", "The model service could not complete this request.")
            return
        self.send_json(200, result)


def main():
    try:
        config = Config.from_env()
    except ValueError as exc:
        print(f"Shiori model service configuration error. {exc}", file=sys.stderr)
        return 1
    with AgentServer(("0.0.0.0", config.port), config) as server:
        server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
