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
`40800bc6e2d7255892e355e5041d3a4501586fef`; the report also records the WPT pin,
tool versions and capture hashes.

| Capture | Passed | Failed | Blocked | Registrations |
| --- | ---: | ---: | ---: | ---: |
| Initial, with every imported case enabled | 799 | 72 | 0 | 871 |
| Final, after source fixes | Pending final capture | Pending final capture | Pending final capture | 871 |

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
