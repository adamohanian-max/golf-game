#!/usr/bin/env python3
"""Dev-drive relay: lets an agent eval JS inside the game running anywhere a
browser can't be automated directly (iOS simulator WKWebView, a phone on the
same WiFi). The game polls this server when booted with ?devdrive=1 (see the
devdrive block at the bottom of game.js) — the page long-polls /pull for a JS
string, evals it, POSTs the JSON result to /push.

Drive it:   curl -s http://127.0.0.1:8787/run --data-binary 'HOLE.par'
/run enqueues the JS and blocks until the page pushes the result (or 30s).

Dev-only tool, never part of the game build. One command in flight at a time.
"""
import http.server
import json
import queue
import threading

PORT = 8787

cmd_q = queue.Queue(maxsize=1)      # JS strings waiting for the page
res_q = queue.Queue(maxsize=1)      # results waiting for /run


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204, "")

    def do_GET(self):
        if self.path == "/pull":
            # Long-poll: hold until a command arrives (or time out empty).
            try:
                js = cmd_q.get(timeout=25)
                self._send(200, json.dumps({"js": js}))
            except queue.Empty:
                self._send(200, json.dumps({}))
        elif self.path == "/ping":
            self._send(200, '"devdrive"')
        else:
            self._send(404, '"not found"')

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8")
        if self.path == "/push":
            # Page pushing an eval result. Drop stale results if /run gave up.
            try:
                res_q.put_nowait(body)
            except queue.Full:
                try:
                    res_q.get_nowait()
                    res_q.put_nowait(body)
                except queue.Empty:
                    pass
            self._send(200, '"ok"')
        elif self.path == "/run":
            # Agent submitting JS: clear any stale result, enqueue, await fresh one.
            while not res_q.empty():
                try:
                    res_q.get_nowait()
                except queue.Empty:
                    break
            try:
                cmd_q.put(body, timeout=5)
            except queue.Full:
                self._send(503, json.dumps({"error": "command already in flight"}))
                return
            try:
                self._send(200, res_q.get(timeout=30))
            except queue.Empty:
                self._send(504, json.dumps({"error": "page never pushed a result (not polling?)"}))
        else:
            self._send(404, '"not found"')


def main():
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"devdrive relay on http://127.0.0.1:{PORT} — game side needs ?devdrive=1")
    srv.serve_forever()


if __name__ == "__main__":
    main()
