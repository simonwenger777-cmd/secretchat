#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import os
import secrets
import threading
import time


HOST = "127.0.0.1"
PORT = 8788
MEDIA_DIR = Path(os.environ.get("SECRETCHAT_MEDIA_DIR", "/var/www/secretchat-media"))
MAX_UPLOAD_BYTES = 220 * 1024 * 1024
MEDIA_TTL_SECONDS = 24 * 60 * 60
CLEANUP_INTERVAL_SECONDS = 60 * 60


def cleanup_old_media():
    cutoff = time.time() - MEDIA_TTL_SECONDS
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    for path in MEDIA_DIR.glob("*.bin"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except FileNotFoundError:
            pass
        except Exception as exc:
            print(f"cleanup failed for {path}: {exc}", flush=True)


def cleanup_loop():
    while True:
        cleanup_old_media()
        time.sleep(CLEANUP_INTERVAL_SECONDS)


class MediaHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path not in ("/upload", "/media-api/upload"):
            self.send_error(404, "Not found")
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_error(400, "Invalid Content-Length")
            return

        if length <= 0:
            self.send_error(400, "Empty upload")
            return
        if length > MAX_UPLOAD_BYTES:
            self.send_error(413, "Upload too large")
            return

        MEDIA_DIR.mkdir(parents=True, exist_ok=True)
        media_id = secrets.token_urlsafe(24)
        target = MEDIA_DIR / f"{media_id}.bin"
        remaining = length

        try:
            with target.open("wb") as handle:
                while remaining > 0:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise ConnectionError("Upload interrupted")
                    handle.write(chunk)
                    remaining -= len(chunk)
        except Exception:
            target.unlink(missing_ok=True)
            self.send_error(500, "Upload failed")
            return

        body = json.dumps({"id": media_id, "url": f"/media-files/{media_id}.bin"}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.send_error(404, "Not found")

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}", flush=True)


if __name__ == "__main__":
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    cleanup_old_media()
    threading.Thread(target=cleanup_loop, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), MediaHandler)
    print(f"secretchat media server listening on http://{HOST}:{PORT}", flush=True)
    server.serve_forever()
