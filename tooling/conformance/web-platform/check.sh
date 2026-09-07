#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
cd "$root"

pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
node --expose-gc --test \
  tooling/conformance/web-platform/test/core.test.mjs \
  tooling/conformance/web-platform/test/cache.test.mjs \
  tooling/conformance/web-platform/test/cookies.test.mjs \
  tooling/conformance/web-platform/test/eventsource.test.mjs \
  tooling/conformance/web-platform/test/network.test.mjs
NTS_WEB_PLATFORM_COMPILED=1 node tooling/conformance/web-platform/test-upstream.mjs
