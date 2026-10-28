# WebSocket: upstream WPT on the source provider

This corpus imports **172 unedited WebSocket fixture files** from
[WPT revision `a8f306ee4399724f33399dfdcac7da296f3cc05a`](https://github.com/web-platform-tests/wpt/tree/a8f306ee4399724f33399dfdcac7da296f3cc05a/websockets).
It covers `websockets/` outside `stream/`, including the applicable HTML interface
tests as well as JavaScript fixtures. The fixtures define **330 ordinary-host
URL-variant runs and 871 test registrations**. The current execution profile has
**846 runnable registrations and 25 explicitly named blocks**.

[manifest.json](manifest.json) records every source path, revision, SHA-256 and
Git blob ID, along with the selected variants, dependencies and exclusions. The
shared runner verifies the hashes before execution. Original file bytes and
existing headers are preserved, including the Windows-1252 HTML sources; files
without individual licence headers remain covered by the unedited
[WPT licence](../server/LICENSE.wpt.md) copied at the same revision.

This work depends on [PR #2](https://github.com/AkisArou/nts/pull/2), which supplies
the shared adapter and events/abort work; [PR #3](https://github.com/AkisArou/nts/pull/3),
which supplies the local Node server; and
[PR #10](https://github.com/AkisArou/nts/pull/10), which extends the shared adapter
for network fixtures, HTML metadata, substitutions and literal `importScripts`.

## Results and reproduction

[before-results.json](before-results.json) preserves the complete initial run,
before WebSocket source fixes and before any named blocks were applied. It gives
counts for all 330 URL variants and aggregates them for all 172 source files.
The recorded baseline driver/source commit is
`ebc8170fae933300a31a047d06c69f4f8c2b18b6`; the report also records the WPT pin,
tool versions and capture hashes.

| Capture | Passed | Failed | Blocked | Registrations |
| --- | ---: | ---: | ---: | ---: |
| Initial, with every imported case enabled | 799 | 72 | 0 | 871 |
| Final, after source fixes | 846 | 0 | 25 | 871 |

[after-results.json](after-results.json) preserves all final variant diagnostics.
[per-file-results.md](per-file-results.md) gives before/after counts for all 172
source files. The source fixes turn 47 initial failures into passes; the other
25 remain explicit blocks. The final standalone capture is at
`af41054060a856b96fdc2c86119b7798c2a9fc86`. These published capture commits have
trees identical to the local trees used for their recorded runs.

All initial registration counts matched the manifest. Node's test totals also
include fixture containers and the enclosing suite; the counts above count WPT
leaf cases only. The 25 cases subsequently classified as blocked remain failures
in the initial report. Applying a block does not turn that failure into a pass.

Use Node **24.20.0** and pnpm **10.15.0**, as pinned by the repository. The recorded
type-checker version is TypeScript **7.0.2**. From the repository root:

```sh
pnpm install
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/wpt-websocket.test.ts
sh tooling/conformance/web-platform/check.sh
```

The last command also runs the package's other checks. Its existing upstream
runner needs the repository's Node WPT validation inputs; this WebSocket corpus
is vendored and needs no network access at test time. Compiled checks are
explicitly skipped when no nts compiler is available.

`NTS_WPT_WEBSOCKET_FILTER` can select a path or query variant for diagnosis. An
unfiltered run is required for the complete counts. The driver uses generous
network deadlines and honors WPT's long-timeout declarations. Upstream server
delays and assertions execute unchanged; the driver adds no machine-speed
assertions.

The complete package check at `150522b7a057ce2f123866dc1d2550d36cae3922` exits 0:
**2,408 Node entries: 2,375 pass, 0 fail, 33 skipped**. The skips are this corpus's
25 named blocks and eight inherited blocks/deferred controls. The existing
upstream runner reports **2,772 pass, 0 fail, 45 not applicable**. The compiled
axis is explicitly skipped because no nts compiler is available. Both the
source and shared-adapter TypeScript projects pass.

The first combined run exposed one stale existing `network.test.ts` expectation
that an offered subprotocol could be omitted. It was corrected to require both
WebSocketStream promises to reject, as the shared opening handshake requires.
The complete network file then passed all 67 tests and the full package check
was rerun successfully. This does not import the separate WebSocketStream WPT
corpus. [validation.json](validation.json) records the commands, counts, capture
commits and evidence hashes, including this initial failure.

### Package-implementation sabotage

After committing the source, an isolated worktree temporarily replaced the
package `WebSocket.send()` string conversion with the fixed text
`"NTS WebSocket WPT sabotage"`. The unchanged `Send-data.any.js` default and WSS
variants both failed their `bufferedAmount` assertion: **0 pass, 2 fail**.
Restoring the exact committed source and repeating the identical filtered run
gave **2 pass, 0 fail**. The isolated worktree is clean. This establishes that
the driver exercises this package's send path, rather than Node's WebSocket.

## Source fixes and specification references

The WebSocket reference is the
[WHATWG snapshot `7f25d7dc8c2598ebca795ce4af68909d913a3888`](https://websockets.spec.whatwg.org/commit-snapshots/7f25d7dc8c2598ebca795ce4af68909d913a3888/)
(19 October 2026), together with RFC 6455. Each runtime fix is its own commit.

| Behavior | Specification | Evidence |
| --- | --- | --- |
| Convert the required send argument before checking connection state; retain binary snapshots. | WebSockets section 3.1 `send()`; Web IDL union/USVString conversion. | Eight failing WPT cases now pass. |
| Convert event-handler assignments with `LegacyTreatNonObjectAsNull`; retain non-callable objects without calling `handleEvent`. | HTML section 8.1.8.1; Web IDL callback conversion and invocation. | 36 failing WPT cases now pass. |
| Serialize opening handshakes to a destination, retaining queue order when a waiter aborts. | RFC 6455 section 4.1 step 2; WebSockets section 2.1. | Both `constructor/014.html` variants now pass; deterministic queue controls. |
| Answer one origin Basic challenge using URL credentials, with a fresh nonce and cancellation intact. | RFC 6455 section 4.1 response step 1; RFC 7617 section 2; WebSockets sections 2.2 and 3.1. | `basic-auth.any.js?wss` now passes; raw/dispatched retry controls. |
| Fail an upgrade when an offered subprotocol is omitted. | WebSockets section 2.2 response step 11.2. | Corrected package server and network controls; imported WPT was already green. |
| Fire trusted protocol events while keeping script redispatch untrusted. | WebSockets section 4; DOM's fire-an-event and dispatchEvent algorithms. | Two supplemental controls fail before and pass after the fix. |
| Invoke handlers for matching event types without requiring a particular Event subclass or message payload. | HTML section 8.1.8.1 `EventHandler(Event)`. | A supplemental synthetic-event control fails before and passes after. |

The last three findings do not reduce the recorded initial WPT failure count.
The corrected WebSocketStream network expectation follows the
[WHATWG PR 48 draft preview, 28 March 2024](https://whatpr.org/websockets/48.html#the-websocketstream-interface),
whose section 4 constructor uses the same opening handshake. Stream-specific
conformance remains a separate item.

The changes leave masking, UTF-8 validation, DEFLATE contexts and payload
snapshot behavior in their existing implementations. No new payload copy or
closure is allocated per frame/message by these fixes. Queue/authentication
allocations occur during connection establishment; event-handler conversion
uses a shared no-op for retained non-callable objects.

### Transport boundaries

Connection serialization keys normalized hostname and effective port. The
connector does not expose the selected peer IP before connecting, so distinct
DNS aliases for one IP require a provider capability to share a reservation.
The hostname fallback follows RFC 6455 section 4.1.

The built-in authentication policy answers one `401 Basic` challenge with URL
credentials using the existing strict UTF-8 userinfo helpers. It adds no prompt,
credential cache, proxy authentication or redirect retry. The controls cover
the raw transport and direct dispatched transport. The existing
`AuthenticationInterceptor` can answer a challenge before the dispatched
WebSocket fallback sees it; its retry currently omits `acceptTunnel` and
`upgradeProtocol`. That independent dispatcher-composition limitation remains
follow-up work and is not claimed as covered here.

## What the execution profile establishes

The driver imports `WebSocket`, `Event`, `EventTarget`, `MessageEvent`,
`CloseEvent`, `Blob` and the other supplied web classes from the package's public
barrel. It installs the existing source runtime with the
[local server capability assembly](../server/runtime.ts). TCP/TLS connections,
the clock, randomness and compression come through the existing host providers.
The server uses the original WPT certificates, preserves logical hostnames for
Host and TLS SNI, and verifies certificates against the explicitly supplied WPT
CA. Its blocked-port routing reaches an accepting local handshake endpoint if
the runtime's port policy is bypassed.

Each fixture receives a fresh VM context with its actual test URL and Origin.
HTML executes the original inline scripts in source order, with pinned external
support and the shared testharness adapter. Character decoding and `.sub.js` or
`.sub.html` substitution occur after the original bytes have been verified.
The two standalone `.worker.js` bodies load only their declared, verified
literal `importScripts` dependencies.

This is an **ordinary-host execution profile**. The manifest records upstream
Window, dedicated-worker, shared-worker and service-worker environments, but
their exposure, lifecycle and multiple-realm behavior are not established by
these runs. `self` names the VM global. Three prototype-setter fixtures use
`window` solely as a name for that same global object; the alias supplies no
Window interface, Document or browsing context. The implementation and fixtures
share ECMAScript buffer constructors so `ArrayBuffer` and typed-array checks
refer to the implementation's realm. Cross-realm behavior is separately
excluded. `URL` is the existing ordinary-node URL capability used by the runtime.

The driver snapshots and restores imported constructor and prototype properties
between fixtures because some upstream tests intentionally replace getters,
install setters or delete attributes. This is test isolation, and does not add
binding behavior to the implementation. The shared adapter records callback
assertion failures, verifies registration counts and requires every named block
to be encountered.

## The 25 named conformance blocks

These cases remain in their original files and registration totals. The manifest
names each exact test and emits it as a skip with a reason. They remain owed
conformance or specification-review work and are never reported as passes.

| Cases | Count across selected variants | Reason and required follow-up |
| --- | ---: | --- |
| `interfaces/WebSocket/constants/002.html` and `003.html` | 16 | Constructor constant descriptor flags belong to deferred nts binding work. |
| `Create-blocked-port.any.js`, ports 4190 and 6679 | 2 | The shared `src/core/network-port.ts` table omits these ports; that file is outside this task. |
| `send-data-isolation.sub.html` | 3 | The unchanged tests require the unavailable `FileReader` interface to inspect returned blobs. |
| `cookies/cross-origin-cookie-set.html` | 1 | The provider has no ambient cookie store or handshake cookie integration. |
| `mixed-content.https.any.js` | 1 | The provider has no secure-context/environment-settings capability for mixed-content policy. |
| `Create-protocols-repeated-case-insensitive.any.js` | 2 | The upstream assertion conflicts with the current duplicate-protocol rule and requires review. |

The constant tests failed because constructor static fields remain writable and
configurable in the ordinary-node binding. Their
[Web IDL descriptor requirements](https://webidl.spec.whatwg.org/#es-constants)
remain owed. The maintainer's
[PR #2 binding decision](https://github.com/AkisArou/nts/commit/437c4fdc45c1125da2f5142063c75dc32d416fcf)
explicitly deferred the equivalent Event constructor descriptor initialization
for nts fixed layouts. This profile follows that decision; it does not add a new
runtime `Object.defineProperty` workaround. Other imported prototype and
interface-policy cases continue to execute.

The two bad-port cases genuinely reached the accepting server in the initial
baseline. They are shared-core defects against
[Fetch's bad-port policy](https://fetch.spec.whatwg.org/#port-blocking), not a
consequence of a missing network listener. Cookie processing and secure-context
policy need the appropriate provider/Fetch integration described by the
[WebSocket opening handshake](https://websockets.spec.whatwg.org/#opening-handshake).
An HTTPS base URL alone does not represent all browser environment settings.

The protocol assertion expects a `SyntaxError` for `"echo"` and `"eCho"`.
[WebSockets section 3.1, constructor step 9](https://websockets.spec.whatwg.org/#dom-websocket-websocket)
rejects repeated values, and
[RFC 6455 section 4.1](https://datatracker.ietf.org/doc/html/rfc6455#section-4.1)
requires unique protocol strings. These strings have distinct values. The
implementation preserves their case and compares duplicates case-sensitively;
the unchanged WPT assertion is recorded as a specification mismatch requiring
upstream review, rather than a browser-capability exclusion.

## Directory and environment exclusions

The manifest partitions all **261** upstream non-stream paths: 172 fixture
files, 44 excluded paths, 42 support/reference paths and three metadata files.
The 44 excluded paths include nine browser helper documents and 35 test files.
Every excluded path has a concrete reason and original source hashes.

Exclusions cover actual Document/iframe operations, legacy UIEvent factories,
browser cookie state, synchronous XMLHttpRequest, worker shutdown, history and
back-forward-cache behavior, and cross-realm constructor/settings semantics.
The complete `idlharness.any.js` needs shared IDL adapter support; the explicit
WebSocket and CloseEvent interface-policy HTML tests are imported independently.
The option-bag and `targetAddressSpace` files target separate proposed extensions
that are absent from the current WebSockets constructor IDL; their proposal and
introducing revisions are recorded in the inventory.

Every declared non-HTTP/2 URL variant is represented for each selected fixture.
The manifest lists **116** HTTP/2 variants across the directory, including
**104** attached to otherwise selected fixtures. They require HTTP/2 extended
CONNECT; the local server and connector implement RFC 6455 HTTP/1.1 over TCP and
TLS. These exclusions do not inflate pass counts. `websockets/stream/` is the
separate WebSocketStream item and is outside this corpus.

The server's Python source copies are provenance references for its TypeScript
handlers. No Python is executed and no additional npm dependency is installed.
