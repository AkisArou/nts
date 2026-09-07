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
  tooling/conformance/web-platform/test/capability-confinement.test.mjs \
  tooling/conformance/web-platform/test/coalescing.test.mjs \
  tooling/conformance/web-platform/test/cookies.test.mjs \
  tooling/conformance/web-platform/test/deduplicate.test.mjs \
  tooling/conformance/web-platform/test/diagnostics.test.mjs \
  tooling/conformance/web-platform/test/dns.test.mjs \
  tooling/conformance/web-platform/test/durable-store.test.mjs \
  tooling/conformance/web-platform/test/early-hints.test.mjs \
  tooling/conformance/web-platform/test/error-taxonomy.test.mjs \
  tooling/conformance/web-platform/test/eventsource.test.mjs \
  tooling/conformance/web-platform/test/eventsource-timing.test.mjs \
  tooling/conformance/web-platform/test/file-url.test.mjs \
  tooling/conformance/web-platform/test/fuzz.test.mjs \
  tooling/conformance/web-platform/test/hpack.test.mjs \
  tooling/conformance/web-platform/test/http2-connection.test.mjs \
  tooling/conformance/web-platform/test/http2-frame.test.mjs \
  tooling/conformance/web-platform/test/http2-headers.test.mjs \
  tooling/conformance/web-platform/test/http2-transport.test.mjs \
  tooling/conformance/web-platform/test/integrity.test.mjs \
  tooling/conformance/web-platform/test/mock-agent.test.mjs \
  tooling/conformance/web-platform/test/negotiated-connect.test.mjs \
  tooling/conformance/web-platform/test/network.test.mjs \
  tooling/conformance/web-platform/test/policy-interceptors.test.mjs \
  tooling/conformance/web-platform/test/pool.test.mjs \
  tooling/conformance/web-platform/test/protocol-select.test.mjs \
  tooling/conformance/web-platform/test/proxy.test.mjs \
  tooling/conformance/web-platform/test/request-fields.test.mjs \
  tooling/conformance/web-platform/test/retry.test.mjs \
  tooling/conformance/web-platform/test/server-handshake.test.mjs \
  tooling/conformance/web-platform/test/snapshot-agent.test.mjs \
  tooling/conformance/web-platform/test/trailers.test.mjs \
  tooling/conformance/web-platform/test/virtual-time.test.mjs \
  tooling/conformance/web-platform/test/websocket-server.test.mjs \
  tooling/conformance/web-platform/test/websocket-server-lifetime.test.mjs \
  tooling/conformance/web-platform/test/weak-listener.test.mjs
NTS_WEB_PLATFORM_COMPILED=1 node tooling/conformance/web-platform/test-upstream.mjs
