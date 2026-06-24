#!/usr/bin/env bash
# Parallel-dev helper: spin up an isolated git worktree + dev server on a free port.
# Lets multiple Claude Code instances (or humans) edit the game without stomping
# each other's files or fighting over port 8080.
#
# Usage:
#   tools/worktree.sh <feature-name>     # create ../golf-game-<feature> on branch <feature>, serve it
#   tools/worktree.sh --list             # show active worktrees + their ports
#   tools/worktree.sh --rm <feature>     # remove a worktree when done
#
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
base_name="$(basename "$repo_root")"
parent_dir="$(dirname "$repo_root")"

pick_port() {
  # Deterministic-ish free port in 8081-8099, skipping any already listening.
  for p in $(seq 8081 8099); do
    if ! lsof -iTCP:"$p" -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "$p"; return 0
    fi
  done
  echo "no free port in 8081-8099" >&2; exit 1
}

case "${1:-}" in
  --list)
    git worktree list
    exit 0
    ;;
  --rm)
    feat="${2:?need feature name}"
    git worktree remove "$parent_dir/${base_name}-${feat}" "${3:-}"
    echo "removed worktree ${base_name}-${feat}"
    exit 0
    ;;
  "" | -h | --help)
    grep '^#' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
esac

feat="$1"
dir="$parent_dir/${base_name}-${feat}"

if git show-ref --quiet "refs/heads/$feat"; then
  git worktree add "$dir" "$feat"
else
  git worktree add "$dir" -b "$feat"
fi

port="$(pick_port)"
echo ""
echo "worktree: $dir"
echo "branch:   $feat"
echo "serving:  http://localhost:$port"
echo "(Ctrl-C to stop server; worktree persists. Remove later: tools/worktree.sh --rm $feat)"
echo ""
cd "$dir"
exec python3 -m http.server "$port"
