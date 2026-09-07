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
  tooling/conformance/web-platform/test/durable-cache-storage.test.mjs \
  tooling/conformance/web-platform/test/durable-cache.test.mjs \
  tooling/conformance/web-platform/test/durable-store.test.mjs \
  tooling/conformance/web-platform/test/early-hints.test.mjs \
  tooling/conformance/web-platform/test/error-taxonomy.test.mjs \
  tooling/conformance/web-platform/test/eventsource.test.mjs \
  tooling/conformance/web-platform/test/eventsource-timing.test.mjs \
  tooling/conformance/web-platform/test/file-url.test.mjs \
  tooling/conformance/web-platform/test/flat-store.test.mjs \
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
  tooling/conformance/web-platform/test/request-replay.test.mjs \
  tooling/conformance/web-platform/test/retry.test.mjs \
  tooling/conformance/web-platform/test/server-handshake.test.mjs \
  tooling/conformance/web-platform/test/snapshot-agent.test.mjs \
  tooling/conformance/web-platform/test/spill.test.mjs \
  tooling/conformance/web-platform/test/trailers.test.mjs \
  tooling/conformance/web-platform/test/virtual-time.test.mjs \
  tooling/conformance/web-platform/test/websocket-server.test.mjs \
  tooling/conformance/web-platform/test/websocket-server-lifetime.test.mjs \
  tooling/conformance/web-platform/test/weak-listener.test.mjs
# The upstream corpus exits nonzero while the eight named structural failures stand,
# and `set -e` made every step after it unreachable -- including the compiled axis,
# which was added precisely so it could not disappear quietly. Its status is held
# and reported at the end instead.
upstream=0
NTS_WEB_PLATFORM_COMPILED=1 node tooling/conformance/web-platform/test-upstream.mjs || upstream=$?

# The compiled axis. Everything above is host evidence -- TypeScript on node, which
# says the algorithms are right and nothing about whether they compile.
#
# Skipped loudly rather than silently when no compiler is present: a step that
# disappears without saying so is how an axis stays at zero without anyone noticing.
if [ -x "${NTS_BIN:-$root/target/release/nts}" ]; then
  tooling/conformance/web-platform/compiled/check.sh
else
  echo "check.sh: SKIPPING the compiled axis -- no compiler at ${NTS_BIN:-$root/target/release/nts}." >&2
  echo "  Host evidence alone does not show that any of this compiles." >&2
fi

if [ "$upstream" -ne 0 ]; then
  echo "check.sh: the upstream corpus exited $upstream -- expected while the eight named" >&2
  echo "  structural failures stand. Every other step above ran and is reported." >&2
  exit "$upstream"
fi
