"""Prototype worker control service. Not yet integrated with Bops."""
import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = os.environ.get("ERNESTA_CONTROL_TOKEN", "")
IMAGE = os.environ.get("ERNESTA_WORKER_IMAGE", "mcr.microsoft.com/playwright:v1.56.1-noble")

def worker_name(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 40 or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in value):
        raise ValueError("Invalid worker ID")
    return "ernesta-" + value

def docker(*args):
    p = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=40, check=True)
    return p.stdout.strip()

def create_worker(value):
    name = worker_name(value)
    return docker("run", "-d", "--name", name, "--label", "ernesta.managed=true",
                  "--network", "none", "--cpus", "2", "--memory", "2g",
                  "--pids-limit", "128", "--security-opt", "no-new-privileges",
                  "--cap-drop", "ALL", "--read-only",
                  "--tmpfs", "/tmp:rw,noexec,nosuid,size=256m", IMAGE, "sleep", "infinity")

def delete_worker(value):
    return docker("rm", "-f", worker_name(value))

class Handler(BaseHTTPRequestHandler):
    def reply(self, status, result):
        body = json.dumps(result).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.reply(200, {"ok": True, "prototype": True}) if self.path == "/health" else self.reply(404, {"error": "Not found"})

    def do_POST(self):
        if not TOKEN or self.headers.get("Authorization") != "Bearer " + TOKEN:
            return self.reply(401, {"error": "Unauthorized"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 1 <= size <= 262144:
                return self.reply(413, {"error": "Invalid request size"})
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError("Expected an object")
            if self.path == "/workers":
                result = {"container": create_worker(payload.get("id"))}
            elif self.path == "/workers/delete":
                result = {"removed": delete_worker(payload.get("id"))}
            else:
                return self.reply(404, {"error": "Not found"})
            self.reply(200, result)
        except (ValueError, TypeError, json.JSONDecodeError):
            self.reply(400, {"error": "Invalid request"})
        except (OSError, subprocess.SubprocessError):
            self.reply(503, {"error": "Worker backend unavailable"})

if __name__ == "__main__":
    if not TOKEN:
        raise SystemExit("ERNESTA_CONTROL_TOKEN is required")
    ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("ERNESTA_PORT", "8765"))), Handler).serve_forever()
