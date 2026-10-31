#!/usr/bin/env bash
# Node's compiled axis. The TypeScript owner validates per-file JSON and keeps
# intact/empty artifacts; only passes lost when exports are emptied count.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
exec node "$root/tooling/conformance/compiled-axis.ts" "$@"
