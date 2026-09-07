#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
cd "$root"

pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
node --expose-gc --test \
  tooling/conformance/web-platform/test/agent.test.mjs \
  tooling/conformance/web-platform/test/core.test.mjs \
  tooling/conformance/web-platform/test/cache-storage.test.mjs \
  tooling/conformance/web-platform/test/cache.test.mjs \
  tooling/conformance/web-platform/test/cookies.test.mjs \
  tooling/conformance/web-platform/test/deduplicate.test.mjs \
  tooling/conformance/web-platform/test/diagnostics.test.mjs \
  tooling/conformance/web-platform/test/dns.test.mjs \
  tooling/conformance/web-platform/test/eventsource.test.mjs \
  tooling/conformance/web-platform/test/hpack.test.mjs \
  tooling/conformance/web-platform/test/http2-connection.test.mjs \
  tooling/conformance/web-platform/test/http2-frame.test.mjs \
  tooling/conformance/web-platform/test/http2-headers.test.mjs \
  tooling/conformance/web-platform/test/http2-transport.test.mjs \
  tooling/conformance/web-platform/test/mock-agent.test.mjs \
  tooling/conformance/web-platform/test/network.test.mjs \
  tooling/conformance/web-platform/test/policy-interceptors.test.mjs \
  tooling/conformance/web-platform/test/pool.test.mjs \
  tooling/conformance/web-platform/test/retry.test.mjs \
  tooling/conformance/web-platform/test/snapshot-agent.test.mjs
NTS_WEB_PLATFORM_COMPILED=1 node tooling/conformance/web-platform/test-upstream.mjs
