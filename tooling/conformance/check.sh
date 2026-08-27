#!/usr/bin/env bash
# Build a module and run node's own tests against the compiled artifact.
#
#   tooling/conformance/check.sh path
#   tooling/conformance/check.sh path --ts     # before it compiles: TypeScript on node
set -euo pipefail
module="${1:?usage: check.sh <module> [--ts] [extra run.mjs args]}"
shift
root="$(cd "$(dirname "$0")/../.." && pwd)"

if [ "${1:-}" = "--ts" ]; then
  shift
  exec node "$root/tooling/conformance/run.mjs" --module "$module" "$@"
fi

"$root/tooling/conformance/build.sh" "$module" >/dev/null
exec node "$root/tooling/conformance/run.mjs" \
  --module "$module" --addon "$root/target/node/$module.node" "$@"
