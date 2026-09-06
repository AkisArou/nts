#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
cd "$root"

pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
node --test \
  tooling/conformance/web-platform/test/core.test.mjs \
  tooling/conformance/web-platform/test/network.test.mjs
