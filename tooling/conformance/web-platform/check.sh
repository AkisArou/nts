#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
cd "$root"

pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false

# Exports nothing mentions. Four mechanisms nothing routed through were found by hand in
# this lane, none of them by looking, so the discipline is a gate rather than a habit.
node tooling/conformance/web-platform/unrouted.mjs
# The environment intrinsics are preloaded, which is what a real environment does with
# them: they exist before the first module runs. Defining them on first import instead
# made them arrive after any suite that reached the platform barrel first.
node --expose-gc \
  --import ./tooling/conformance/web-platform/environment-shim.ts \
  --test \
  tooling/conformance/web-platform/test/accept-loop.test.ts \
  tooling/conformance/web-platform/test/agent.test.ts \
  tooling/conformance/web-platform/test/core.test.ts \
  tooling/conformance/web-platform/test/authenticate.test.ts \
  tooling/conformance/web-platform/test/cache-storage.test.ts \
  tooling/conformance/web-platform/test/cache.test.ts \
  tooling/conformance/web-platform/test/capability-confinement.test.ts \
  tooling/conformance/web-platform/test/coalescing.test.ts \
  tooling/conformance/web-platform/test/cookies.test.ts \
  tooling/conformance/web-platform/test/deduplicate.test.ts \
  tooling/conformance/web-platform/test/dispatched-websocket.test.ts \
  tooling/conformance/web-platform/test/diagnostics.test.ts \
  tooling/conformance/web-platform/test/dns.test.ts \
  tooling/conformance/web-platform/test/durable-cache-storage.test.ts \
  tooling/conformance/web-platform/test/durable-cache.test.ts \
  tooling/conformance/web-platform/test/durable-store.test.ts \
  tooling/conformance/web-platform/test/early-hints.test.ts \
  tooling/conformance/web-platform/test/error-taxonomy.test.ts \
  tooling/conformance/web-platform/test/webidl-surface.test.ts \
  tooling/conformance/web-platform/test/idl-internal-surface.test.ts \
  tooling/conformance/web-platform/test/durable-cookie-jar.test.ts \
  tooling/conformance/web-platform/test/json-parse.test.ts \
  tooling/conformance/web-platform/test/json-stringify.test.ts \
  tooling/conformance/web-platform/test/identity.test.ts \
  tooling/conformance/web-platform/test/proxy-resolution.test.ts \
  tooling/conformance/web-platform/test/event-timestamp.test.ts \
  tooling/conformance/web-platform/test/event-timestamp-bare.test.ts \
  tooling/conformance/web-platform/test/eventsource.test.ts \
  tooling/conformance/web-platform/test/eventsource-timing.test.ts \
  tooling/conformance/web-platform/test/file-url.test.ts \
  tooling/conformance/web-platform/test/flat-store.test.ts \
  tooling/conformance/web-platform/test/fuzz.test.ts \
  tooling/conformance/web-platform/test/hpack.test.ts \
  tooling/conformance/web-platform/test/interceptor-order.test.ts \
  tooling/conformance/web-platform/test/http2-connection.test.ts \
  tooling/conformance/web-platform/test/http2-frame.test.ts \
  tooling/conformance/web-platform/test/http2-headers.test.ts \
  tooling/conformance/web-platform/test/http2-transport.test.ts \
  tooling/conformance/web-platform/test/integrity.test.ts \
  tooling/conformance/web-platform/test/mock-agent.test.ts \
  tooling/conformance/web-platform/test/negotiated-connect.test.ts \
  tooling/conformance/web-platform/test/operations.test.ts \
  tooling/conformance/web-platform/test/network.test.ts \
  tooling/conformance/web-platform/test/policy-interceptors.test.ts \
  tooling/conformance/web-platform/test/pool.test.ts \
  tooling/conformance/web-platform/test/protocol-select.test.ts \
  tooling/conformance/web-platform/test/proxy.test.ts \
  tooling/conformance/web-platform/test/request-head.test.ts \
  tooling/conformance/web-platform/test/request-fields.test.ts \
  tooling/conformance/web-platform/test/request-replay.test.ts \
  tooling/conformance/web-platform/test/retry.test.ts \
  tooling/conformance/web-platform/test/server-handshake.test.ts \
  tooling/conformance/web-platform/test/snapshot-agent.test.ts \
  tooling/conformance/web-platform/test/spill.test.ts \
  tooling/conformance/web-platform/test/textdecoder-differential.test.ts \
  tooling/conformance/web-platform/test/trailers.test.ts \
  tooling/conformance/web-platform/test/tunnel.test.ts \
  tooling/conformance/web-platform/test/utf8-differential.test.ts \
  tooling/conformance/web-platform/test/virtual-time.test.ts \
  tooling/conformance/web-platform/test/websocket-server.test.ts \
  tooling/conformance/web-platform/test/websocket-server-lifetime.test.ts \
  tooling/conformance/web-platform/test/weak-listener.test.ts
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
