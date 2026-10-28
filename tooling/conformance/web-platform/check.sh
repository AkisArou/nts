#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
cd "$root"

node runtime/web-platform/test/wpt/verify-versions.ts

pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false

# Exports nothing mentions. Four mechanisms nothing routed through were found by hand in
# this lane, none of them by looking, so the discipline is a gate rather than a habit.
node tooling/conformance/web-platform/unrouted.mjs
# Every test file on disk must appear in the list below. The list is explicit on purpose --
# it fixes the order and lets a file be held back deliberately -- but the failure mode is that
# a new file simply never runs, which reads exactly like a file that passes. Two had already
# slipped through when this was added.
for file in runtime/web-platform/test/*.test.ts; do
  grep -q "$(basename "$file")" "$0" || {
    echo "check.sh: $file is not named below, so it would not run." >&2
    echo "  Add it to the list, or say in the file why it is held back." >&2
    exit 2
  }
done

# The environment intrinsics are preloaded, which is what a real environment does with
# them: they exist before the first module runs. Defining them on first import instead
# made them arrive after any suite that reached the platform barrel first.
# One generous hang bound covers this host invocation. Individual assertions
# wait for their own completion; load cannot turn an eight-second pause into
# an assertion failure. A hang remains a distinct timeout result (exit 124).
host=0
timeout --kill-after=10s 900s node --expose-gc \
  --import ./runtime/web-platform/host/environment-shim.ts \
  --test \
  runtime/web-platform/test/accept-loop.test.ts \
  runtime/web-platform/test/agent.test.ts \
  runtime/web-platform/test/core.test.ts \
  runtime/web-platform/test/crypto.test.ts \
  runtime/web-platform/test/crypto-key.test.ts \
  runtime/web-platform/test/crypto-algorithms.test.ts \
  runtime/web-platform/test/crypto-ec-der.test.ts \
  runtime/web-platform/test/crypto-ec-derive.test.ts \
  runtime/web-platform/test/crypto-ec-key.test.ts \
  runtime/web-platform/test/crypto-ec-provider.test.ts \
  runtime/web-platform/test/crypto-ec-wrap.test.ts \
  runtime/web-platform/test/crypto-ec.test.ts \
  runtime/web-platform/test/crypto-normalization.test.ts \
  runtime/web-platform/test/crypto-provider.test.ts \
  runtime/web-platform/test/crypto-aes.test.ts \
  runtime/web-platform/test/crypto-jwk.test.ts \
  runtime/web-platform/test/crypto-secret-key.test.ts \
  runtime/web-platform/test/crypto-rsa-der.test.ts \
  runtime/web-platform/test/crypto-rsa-key.test.ts \
  runtime/web-platform/test/crypto-rsa-provider.test.ts \
  runtime/web-platform/test/crypto-rsa-wrap.test.ts \
  runtime/web-platform/test/crypto-rsa.test.ts \
  runtime/web-platform/test/wpt-harness.test.ts \
  runtime/web-platform/test/wpt-runner.test.ts \
  runtime/web-platform/test/wpt-versions.test.ts \
  runtime/web-platform/test/wpt-html-support.test.ts \
  runtime/web-platform/test/wpt-file-harness.test.ts \
  runtime/web-platform/test/wpt-events-abort.test.ts \
  runtime/web-platform/test/wpt-streams.test.ts \
  runtime/web-platform/test/wpt-fetch-data.test.ts \
  runtime/web-platform/test/wpt-files-forms.test.ts \
  runtime/web-platform/test/wpt-domexception.test.ts \
  runtime/web-platform/test/domexception-policy.test.ts \
  runtime/web-platform/test/wpt-promise-rejection-event.test.ts \
  runtime/web-platform/test/promise-rejection-event-policy.test.ts \
  runtime/web-platform/test/wpt-performance.test.ts \
  runtime/web-platform/test/wpt-performance-adapter.test.ts \
  runtime/web-platform/test/performance-policy.test.ts \
  runtime/web-platform/test/wpt-urlpattern.test.ts \
  runtime/web-platform/test/fetch-headers-wpt-policy.test.ts \
  runtime/web-platform/test/fetch-body-wpt-policy.test.ts \
  runtime/web-platform/test/fetch-multipart-wpt-policy.test.ts \
  runtime/web-platform/test/file-forms-wpt-policy.test.ts \
  runtime/web-platform/test/file-reader-wpt-policy.test.ts \
  runtime/web-platform/test/file-forms-urlencoded-policy.test.ts \
  runtime/web-platform/test/navigator-user-agent-policy.test.ts \
  runtime/web-platform/test/urlpattern-policy.test.ts \
  runtime/web-platform/test/urlpattern-adapter-policy.test.ts \
  runtime/web-platform/test/wpt-global-errors.test.ts \
  runtime/web-platform/test/global-errors-policy.test.ts \
  runtime/web-platform/test/global-errors-harness-policy.test.ts \
  runtime/web-platform/test/wpt-encoding.test.ts \
  runtime/web-platform/test/encoding-policy.test.ts \
  runtime/web-platform/test/encoding-stream-policy.test.ts \
  runtime/web-platform/test/streams-wpt-policy.test.ts \
  runtime/web-platform/test/event-wpt-policy.test.ts \
  runtime/web-platform/test/abort-wpt-policy.test.ts \
  runtime/web-platform/test/authenticate.test.ts \
  runtime/web-platform/test/cache-storage.test.ts \
  runtime/web-platform/test/cache.test.ts \
  runtime/web-platform/test/capability-confinement.test.ts \
  runtime/web-platform/test/coalescing.test.ts \
  runtime/web-platform/test/cookies.test.ts \
  runtime/web-platform/test/deduplicate.test.ts \
  runtime/web-platform/test/dispatched-websocket.test.ts \
  runtime/web-platform/test/diagnostics.test.ts \
  runtime/web-platform/test/dns.test.ts \
  runtime/web-platform/test/durable-cache-storage.test.ts \
  runtime/web-platform/test/durable-cache.test.ts \
  runtime/web-platform/test/durable-store.test.ts \
  runtime/web-platform/test/early-hints.test.ts \
  runtime/web-platform/test/error-taxonomy.test.ts \
  runtime/web-platform/test/webidl-surface.test.ts \
  runtime/web-platform/test/idl-internal-surface.test.ts \
  runtime/web-platform/test/durable-cookie-jar.test.ts \
  runtime/web-platform/test/idl-iterator.test.ts \
  runtime/web-platform/test/json-parse.test.ts \
  runtime/web-platform/test/json-plain.test.ts \
  runtime/web-platform/test/json-plain-parse.test.ts \
  runtime/web-platform/test/json-stringify.test.ts \
  runtime/web-platform/test/json-surface.test.ts \
  runtime/web-platform/test/identity.test.ts \
  runtime/web-platform/test/proxy-resolution.test.ts \
  runtime/web-platform/test/event-timestamp.test.ts \
  runtime/web-platform/test/event-timestamp-bare.test.ts \
  runtime/web-platform/test/eventsource.test.ts \
  runtime/web-platform/test/eventsource-timing.test.ts \
  runtime/web-platform/test/eventsource-wpt-policy.test.ts \
  runtime/web-platform/test/file-url.test.ts \
  runtime/web-platform/test/flat-store.test.ts \
  runtime/web-platform/test/fuzz.test.ts \
  runtime/web-platform/test/hpack.test.ts \
  runtime/web-platform/test/interceptor-order.test.ts \
  runtime/web-platform/test/http2-connection.test.ts \
  runtime/web-platform/test/http2-frame.test.ts \
  runtime/web-platform/test/http2-headers.test.ts \
  runtime/web-platform/test/http2-transport.test.ts \
  runtime/web-platform/test/integrity.test.ts \
  runtime/web-platform/test/mock-agent.test.ts \
  runtime/web-platform/test/negotiated-connect.test.ts \
  runtime/web-platform/test/operations.test.ts \
  runtime/web-platform/test/network-port.test.ts \
  runtime/web-platform/test/network.test.ts \
  runtime/web-platform/test/policy-interceptors.test.ts \
  runtime/web-platform/test/pool.test.ts \
  runtime/web-platform/test/protocol-select.test.ts \
  runtime/web-platform/test/proxy.test.ts \
  runtime/web-platform/test/request-head.test.ts \
  runtime/web-platform/test/request-fields.test.ts \
  runtime/web-platform/test/request-replay.test.ts \
  runtime/web-platform/test/retry.test.ts \
  runtime/web-platform/test/server-handshake.test.ts \
  runtime/web-platform/test/snapshot-agent.test.ts \
  runtime/web-platform/test/spill.test.ts \
  runtime/web-platform/test/streams-then.test.ts \
  runtime/web-platform/test/textdecoder-differential.test.ts \
  runtime/web-platform/test/trailers.test.ts \
  runtime/web-platform/test/tunnel.test.ts \
  runtime/web-platform/test/utf8-differential.test.ts \
  runtime/web-platform/test/virtual-time.test.ts \
  runtime/web-platform/test/websocket-server.test.ts \
  runtime/web-platform/test/websocket-server-lifetime.test.ts \
  runtime/web-platform/test/websocket-handshake-policy.test.ts \
  runtime/web-platform/test/websocket-interop-policy.test.ts \
  runtime/web-platform/test/websocket-wpt-policy.test.ts \
  runtime/web-platform/test/websocket-stream-wpt-policy.test.ts \
  runtime/web-platform/test/wpt-server.test.ts \
  runtime/web-platform/test/wpt-websocket-server.test.ts \
  runtime/web-platform/test/wpt-eventsource-server.test.ts \
  runtime/web-platform/test/wpt-fetch-server.test.ts \
  runtime/web-platform/test/wpt-eventsource.test.ts \
  runtime/web-platform/test/wpt-websocket-stream-lifetime.test.ts \
  runtime/web-platform/test/wpt-websocket-stream.test.ts \
  runtime/web-platform/test/wpt-websocket.test.ts \
  runtime/web-platform/test/weak-listener.test.ts || host=$?
if [ "$host" -eq 124 ] || [ "$host" -eq 137 ]; then
  echo "check.sh: TIMED OUT -- host suite exceeded its outer hang bound." >&2
  exit 124
fi
if [ "$host" -ne 0 ]; then
  exit "$host"
fi
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
