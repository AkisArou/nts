# The web platform runtime

The contract `runtime/web-platform` implements: nts's TypeScript
implementation of the web APIs a server or mobile program uses (Fetch,
Streams, WebSocket, server-sent events, the File API, cookies, HTTP caching),
the shape of its modules, the primitives a platform supplies beneath them, and
how it is tested. For runtime work and for anyone binding these APIs to a
target. Which implementation of a global a target uses is decided by
[builtins](../foundations/builtins.md).

## The profile

**Complete for a standalone server or mobile program:** every
standards-derived behaviour such a program can use, plus the applicable
extensions of a pinned Undici (the Node and server reference) and of Expo (the
mobile reference). The normative references are WHATWG Fetch, Streams and
WebSockets, ECMA-262's `JSON`, and the HTTP, caching, cookie, proxy,
content-coding, server-sent-events and WebSocket-extension RFCs beneath them.

**Excluded, because they need a browser document:** CORS and preflight,
opaque filtered responses, service-worker interception, navigation, CSP,
mixed-content and Permissions Policy enforcement, storage partitioning,
`FormData` built from a DOM form, and document-origin referrer policy. Dynamic
WebIDL behaviour (prototype graphs, property descriptors, a mutable global
object) is outside nts's object model ([language/boundaries.md](../language/boundaries.md)).
A compiler gap is a dependency, never an exclusion.

## The public surface

`src/index.ts` exports the web values; everything else (parsers, pools,
codecs, provider primitives, internal errors) is not a web global.

| area | values |
|---|---|
| errors and events | `DOMException`, `Event`, `EventTarget`, `CustomEvent`, `MessageEvent`, `CloseEvent`, `ErrorEvent` |
| cancellation | `AbortController`, `AbortSignal` |
| encoding | `TextEncoder`, `TextDecoder`, `TextEncoderStream`, `TextDecoderStream` |
| streams | `ReadableStream` with default and BYOB readers and byte controllers, `WritableStream`, `TransformStream`, `ByteLengthQueuingStrategy`, `CountQueuingStrategy` |
| fetch | `fetch`, `Headers`, `Request`, `Response`, a cookie policy for `fetch` |
| forms and files | `FormData`, `URLSearchParams`, `Blob`, `File` |
| WebSocket | `WebSocket`, `WebSocketStream`, `WebSocketError` |
| server-sent events | `EventSource` |
| caches | `Cache` and `CacheStorage`; an RFC 9111 `HttpCache` with memory and durable stores; `Cache-Control` and freshness helpers |
| cookies | parse and serialize helpers; `CookieJar` with memory and durable stores |
| dispatch | Undici's shape: `Agent`, `Client`, `Pool`, `BalancedPool`, `RoundRobinPool`, `ProxyAgent`, `EnvHttpProxyAgent`, `Socks5ProxyAgent`, `RetryAgent`; interceptors for retry, deduplication, response errors, bounded dumps, diagnostics and authentication; DNS caching; HTTP CONNECT and SOCKS5 proxies with environment and system proxy policy; protocol selection |
| testing | `MockAgent`, `MockClient`, `MockPool` and their call history; `SnapshotAgent` |

`src/json` implements `JSON.parse` (with its reviver and `context.source`),
`JSON.stringify` (with its replacer and `space`), `JSON.rawJSON` and
`JSON.isRawJSON` over an erased JSON value graph, and is the oracle for the
parsers the compiler generates ([JSON](../foundations/json.md)). It is decided
to move to `runtime/ecmascript`, and to serve an untyped `JSON.parse` until the
compiler parses untyped JSON itself, then to stay as the test oracle
([JSON](../foundations/json.md#decisions)).

`URL` is not here yet: the WHATWG URL implementation is `runtime/node/url`, and
the web platform reaches a URL parser through its provider (`URLParser`).
Moving `URL` here, one package per spec family, is decided
([builtins](../foundations/builtins.md#decisions)).

## The modules

| directory | holds |
|---|---|
| `core` | events, abort, `DOMException`, encoding and its streams, UTF-8, base64, percent-encoding, WebIDL conversions |
| `streams` | the Web Streams implementation |
| `fetch` | `Headers`, `Request`, `Response`, bodies, `fetch` and its policy: redirects, integrity, content coding, `data:`, `blob:` and capability-scoped `file:` URLs |
| `forms`, `file` | `FormData`, URL-encoding, MIME and multipart; `Blob`, `File` and object URLs |
| `http`, `http1`, `http2` | field and address validation and certificate name matching; a strict streaming HTTP/1.1 engine; HTTP/2 framing, connection management and HPACK |
| `dispatch` | agents, clients, pools, interceptors, proxies, DNS, protocol selection |
| `websocket` | the client API, `WebSocketStream`, the RFC 6455 codec, `permessage-deflate`, and a WebSocket server for Node and servers |
| `eventsource` | `EventSource` |
| `cache`, `cookies`, `storage` | HTTP caching and `CacheStorage`; cookie parsing and jars; durable byte storage and spill-to-disk for large bodies |
| `mock` | mock and snapshot agents |
| `json` | `JSON` |
| `provider` | the provider contract, the environment slot, virtual time, and `WebPlatformRuntime` |

`src/provider.ts` is the stable entry point providers import; it is not part of
the web surface.

**Rules every module keeps:**

- **No ambient globals.** Shared source is checked without DOM or Node
  declarations (`types: []`) and imports no platform module. A provider
  imports only typed capabilities.
- **One class per web value, no synthetic realms.** Each value is one
  top-level class. The per-environment state (transports, policy, scheduler,
  connection pools, open sessions, close state) is a `WebPlatformRuntime`,
  installed into the current nts environment through three intrinsics
  (`nts_environment_install_platform` and its readers) that every backend
  implements.
- **No compiled `globalThis`.** Compiled TypeScript never reads or writes a
  global object. A provider's bootstrap exposes the globals.
- **Observable policy stays shared.** Redirects, cookies, caching,
  decompression policy, errors, cancellation and object semantics are this
  layer's, whichever transport sits below. Content decoding defaults to a
  256 MiB decoded-body ceiling and a 100:1 decoded-to-wire ratio after a 1 MiB
  grace allowance; both are configurable, and an encoding is advertised only
  where a decoder validates it.

## The provider contract

A platform implements `PlatformPrimitives` and the capabilities around it, and
nothing observable:

| primitive | supplies |
|---|---|
| `sockets` | TCP connections as `ByteConnection`s; a negotiating connector adds ALPN |
| `TlsUpgrader` | TLS over an existing connection, with SNI, ALPN and hostname verification |
| `SocketBinder`, `SocketListener` | listening sockets, for the WebSocket server |
| `DnsResolver` | address resolution; caching and staggered connection attempts are above the seam |
| `random` | random bytes |
| `scheduler` | task queueing (never inline), cancellable delays, error reporting |
| `urls` | WHATWG URL parsing |
| `nativeLineEnding` | `"\n"` or `"\r\n"`, for `Blob`'s native endings |
| `wallTimeMilliseconds()` | wall-clock time, in the frame HTTP dates use |
| `monotonicMilliseconds()` | a stopwatch: non-decreasing within one provider |
| `systemProxyFor(url)` | the platform's already-resolved proxy answer, in PAC result syntax, or `null` for none. A provider never evaluates PAC itself |
| `ContentDecoder` | streaming gzip, deflate and Brotli primitives |
| WebSocket deflate | bounded raw-DEFLATE contexts, where `permessage-deflate` is offered |
| durable storage | a namespaced byte store with streaming writes, atomic commit, enumeration and size accounting |

| provider | where | state |
|---|---|---|
| ordinary node, for tests only | `runtime/web-platform/host/` | built: Node's TCP, TLS, timers, randomness and zlib as primitives; never node's own `fetch`, `WebSocket` or `http` |
| the JVM and Android | `runtime/jvm/web-platform/` and its Android Java | built: socket, TLS and durable-store primitives ([JVM](../targets/jvm.md)) |
| native, Node-compatible | `runtime/node/internal/web-platform` | not built |
| iOS | the LLVM runtime with Swift or Objective-C | not built |

## Ownership

**One implementation of each web value per environment.** A Node module that
exposes a web value re-exports this one exactly: no wrapping, copying,
subclassing or second constructor. Today `runtime/node` imports the event,
encoding, streams and WebIDL modules from here, while it still carries its own
`URLSearchParams` (`runtime/node/url`) and `Blob` and `File`
(`runtime/node/buffer`), against decision 10 (contradiction 2 in
[open questions](../open-questions.md)).

**Reachable from no global yet.** A compiled program reaches these values only
by importing their modules; binding them as builtins is
[builtins](../foundations/builtins.md#stages-smallest-first) stages 5 and 10
(`TextEncoder`, `TextDecoder`, `atob`, `btoa`, `AbortController` and `JSON`
first, then the network).

## Testing

- **Host tests:** `runtime/web-platform/test/*.test.ts` run under `node --test`
  with the environment preloaded (`host/environment-shim.ts`), through
  `tooling/conformance/web-platform/check.sh`. The script also typechecks the
  host project, checks that every export is routed through something
  (`unrouted.mjs`), and fails if a test file on disk is not in its list. The
  tests use in-memory connections, deterministic randomness and virtual time.
- **Upstream tests:** complete, unchanged web-platform-tests files (Fetch and
  `data:` URLs, `WebSocketStream`, `EventSource`, `FormData`, the Cache API),
  pinned by content hash in `third_party/wpt/manifest.json`, run by
  `test-upstream.mjs` with the small part of `testharness.js` they need. A
  failure stays a failure; a test is never edited into agreement. HPACK is
  also checked against the pinned `hpack-test-case` corpus
  (`test-hpack-upstream.mjs`), outside the offline run.
- **The compiled axis:** `tooling/conformance/web-platform/compiled/` imports
  the shared source that compiles today, and [`nts check`](cli.md#nts-check)
  compiles it and compares it with node on the JVM, C and LLVM. Everything else
  is host evidence: it shows the algorithms are right, not that they compile.
  The axis grows as the compiler does, never by rewriting the source to fit.
- **The gate** compiles `runtime/web-platform` beside `runtime/node` in the full
  run's runtime-module steps, and a change to the harness asks for a
  `check.sh` run before review.
- **The Undici ledger,** `docs/UNDICI-API-LEDGER.md` in the runtime, marks each
  export of the pinned Undici as implemented, deliberately different or not
  applicable.

## Decisions

- **The canonical `URLSearchParams`, `Blob` and `File` are web-platform's;**
  `runtime/node` re-exports them
  ([log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22), decision 10).
- **Only `@nts/*` packages provide `es:*` and `web:*` features**
  ([log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22), decision 9).
- **On JS hosts, take the host's builtins;** each feature is chosen by its
  benchmark row and conformance record
  ([log](../records/notebooks/decisions-log.md#builtins-and-runtimes-10-22), decision 3).
- **The TypeScript URL and HTTP parsers stay,** with ada and llhttp as C++
  references in benchmark rows, replaced only where a row loses
  ([log](../records/notebooks/decisions-log.md#memory-and-vendored-code-10-22-10-23)).
- **OpenSSL 3.5 is vendored** for native TLS and crypto; today `crypto` links
  the system's libcrypto (D-1)
  ([log](../records/notebooks/decisions-log.md#memory-and-vendored-code-10-22-10-23)).
