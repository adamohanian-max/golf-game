#!/usr/bin/env python3
"""Local admin companion server — serve the game AND bake new courses on demand.

Drop-in replacement for `python3 -m http.server 8080`: serves the static game
from the repo root, plus a small JSON API the in-game admin "Add course" UI calls.

  GET  /api/ping            -> {"ok": true}              (UI shows the Add button only if this answers)
  GET  /api/search?q=<name> -> [{id,name,sub,boundaryId,kind,center}, ...]   (live Overpass name search)
  POST /api/bake            -> runs tools/fetch_course_global.py, STREAMS progress text,
                               on success appends courses/manifest.json + git commits.

Only runs where you start it (your machine). A static deploy (GitHub Pages) has no
/api, so the Add button stays hidden there — bake locally, commit, push to ship.

Usage:
  python3 tools/bake_server.py [--port 8080] [--no-git] [--push]

Pure stdlib. The bake itself (fetch_course_global.py) is unchanged.
"""
import argparse, json, os, re, subprocess, sys, urllib.parse, urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

TOOLS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(TOOLS)                       # repo root
COURSES = os.path.join(ROOT, "courses")
MANIFEST = os.path.join(COURSES, "manifest.json")
OVERPASS = "https://overpass-api.de/api/interpreter"
UA = "golf-game-dev/1.0 (bake server)"

sys.path.insert(0, TOOLS)
import build_index as bi                            # reuse slugify

GIT = True
PUSH = False


# --- Overpass name search --------------------------------------------------
def overpass_search_name(q):
    """Global golf-course search by name regex. Returns candidate records."""
    safe = re.sub(r'["\\\n]', " ", q).strip()       # keep the regex well-formed
    if not safe:
        return []
    query = (f'[out:json][timeout:60];'
             f'(way["leisure"="golf_course"]["name"~"{safe}",i];'
             f' relation["leisure"="golf_course"]["name"~"{safe}",i];);'
             f'out tags center;')
    req = urllib.request.Request(
        OVERPASS + "?" + urllib.parse.urlencode({"data": query}),
        headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=70) as r:
        data = json.load(r)
    out, seen = [], set()
    for el in data.get("elements", []):
        name = el.get("tags", {}).get("name")
        c = el.get("center") or {}
        if not name or "lat" not in c:
            continue
        slug = bi.slugify(name)
        if slug in seen:
            continue
        seen.add(slug)
        out.append({
            "id": slug, "name": name,
            "boundaryId": el["id"], "kind": el["type"],   # "way" | "relation"
            "center": [round(c["lat"], 5), round(c["lon"], 5)],
            "sub": f'{round(c["lat"], 3)}, {round(c["lon"], 3)}',
        })
        if len(out) >= 25:
            break
    return out


# --- manifest + git --------------------------------------------------------
def course_sub(course_id, center):
    """Build a list subtitle from the freshly baked course JSON + search center."""
    try:
        with open(os.path.join(COURSES, course_id + ".json")) as f:
            c = json.load(f)
        holes = c.get("holes", [])
        par = sum(h.get("par", 0) for h in holes)
        bits = []
        if par:
            bits.append(f"Par {par}")
        bits.append(f"{len(holes)} holes")
        sub = " · ".join(bits)
    except Exception:
        sub = "Baked course"
    if center:
        sub += f" · {center[0]:.2f}, {center[1]:.2f}"
    return sub


def append_manifest(course_id, name, sub):
    try:
        with open(MANIFEST) as f:
            arr = json.load(f)
    except Exception:
        arr = []
    if any(e.get("id") == course_id for e in arr):
        return
    arr.append({"id": course_id, "name": name, "sub": sub})
    with open(MANIFEST, "w") as f:
        json.dump(arr, f, indent=2, ensure_ascii=False)
        f.write("\n")


def git_commit(course_id):
    if not GIT:
        return "git: skipped (--no-git)"
    paths = [os.path.join("courses", course_id + ".json"),
             os.path.join("courses", "img", course_id),
             os.path.join("courses", "manifest.json")]
    try:
        subprocess.run(["git", "add", *paths], cwd=ROOT, check=True,
                       capture_output=True, text=True)
        subprocess.run(["git", "commit", "-m", f"add course {course_id}"],
                       cwd=ROOT, check=True, capture_output=True, text=True)
        msg = f"git: committed {course_id}"
        if PUSH:
            subprocess.run(["git", "push"], cwd=ROOT, check=True,
                           capture_output=True, text=True)
            msg += " + pushed"
        return msg
    except subprocess.CalledProcessError as e:
        return f"git: failed — {(e.stderr or e.stdout or '').strip()[:300]}"


# --- request handler -------------------------------------------------------
class Handler(SimpleHTTPRequestHandler):
    # serve static files from the repo root
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, fmt, *args):
        # keep the API quiet; static logs are noise during a bake
        if self.path.startswith("/api/"):
            sys.stderr.write("[api] " + (fmt % args) + "\n")

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/api/ping":
            return self._json(200, {"ok": True})
        if u.path == "/api/search":
            q = (urllib.parse.parse_qs(u.query).get("q") or [""])[0].strip()
            if len(q) < 2:
                return self._json(200, [])
            try:
                return self._json(200, overpass_search_name(q))
            except Exception as e:
                return self._json(502, {"error": f"search failed: {e}"})
        return super().do_GET()                      # static files

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != "/api/bake":
            return self._json(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._json(400, {"error": "bad JSON"})
        self._bake(payload)

    def _bake(self, p):
        boundary_id = p.get("boundaryId")
        kind = p.get("kind")
        name = (p.get("name") or "").strip()
        course_id = bi.slugify(p.get("id") or name)
        center = p.get("center")
        if not boundary_id or not name or not course_id:
            return self._json(400, {"error": "need boundaryId, name, id"})
        if os.path.exists(os.path.join(COURSES, course_id + ".json")):
            return self._json(409, {"error": f"'{course_id}' already baked"})

        flag = "--boundary-rel" if kind == "relation" else "--boundary-way"
        cmd = [sys.executable, os.path.join("tools", "fetch_course_global.py"),
               flag, str(boundary_id), "--id", course_id, "--name", name]

        # stream the subprocess output as it runs (HTTP/1.0 + close = readable stream)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()

        def emit(line):
            try:
                self.wfile.write(line.encode("utf-8", "replace"))
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass

        emit(f"$ {' '.join(cmd)}\n\n")
        proc = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True, bufsize=1)
        for line in proc.stdout:
            emit(line)
        code = proc.wait()

        if code == 0 and os.path.exists(os.path.join(COURSES, course_id + ".json")):
            sub = course_sub(course_id, center)
            append_manifest(course_id, name, sub)
            emit("\n" + git_commit(course_id) + "\n")
            emit(f"\n__BAKE_OK__ {json.dumps({'id': course_id, 'name': name, 'sub': sub})}\n")
        else:
            emit(f"\n__BAKE_FAIL__ bake exited {code}\n")


def main():
    global GIT, PUSH
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--no-git", action="store_true", help="don't commit baked courses")
    ap.add_argument("--push", action="store_true", help="git push after each commit")
    args = ap.parse_args()
    GIT = not args.no_git
    PUSH = args.push
    srv = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print(f"bake-server: http://localhost:{args.port}  (root {ROOT})")
    print(f"  git commit: {'on' if GIT else 'off'}   push: {'on' if PUSH else 'off'}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
