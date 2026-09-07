# Standalone Undici API ledger

## Reference and status rules

The compatibility reference is standalone Undici `8.10.2`, tag/tree
`5e541e0b9df7563e5766bbd469fbfe383d9ae6ca`, npm integrity
`sha512-/y4/bH9YNU5hi9NIrpOuvGXFcxrj3CMrV+/AYpowAYTpHn8gX/XPFjNy766FPoYY0miQhdW977JFWKGNhBdwyQ==`.
The repository's bundled Node reference, Undici `7.29.0`, is a second compatibility
point and not the ceiling. This ledger is an inventory of the `8.10.2` package entry
point, its API documentation, and the additional server/mobile requirements in the
integration plan.

Statuses are deliberately strict:

- **shared** means the behavior is implemented in canonical shared TypeScript and
  covered by an applicable test. It does not claim an `import "undici"` facade.
- **provider** means the portable provider contract or reference engine exists, but
  at least one production provider or final protocol-selection path is incomplete.
- **facade** means the shared behavior exists but the exact Node package-level name,
  overload, classic-stream adapter, dynamic record, or error class is still missing.
- **dependency** names work that must land before the operation can be implemented
  without a substitute API or host delegation.
- **missing** means no implementation exists yet. It is never an exclusion.
- **different** is a deliberate statically typed API difference. The exact Node
  facade may still adapt it where doing so does not violate the TypeScript model.
- **not applicable** is reserved for behavior that genuinely requires an absent
  browser concept; none of the dispatcher rows below uses it.

An implemented row must eventually point to compiled native, JVM/Android and
LLVM/iOS evidence. Host-only evidence cannot promote a row beyond **shared** or
**provider**.

## Dispatcher and connection APIs

| Undici surface                               | Status   | NTS mapping or remaining obligation                                                                                                             |
| -------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dispatcher.dispatch`                        | provider | `FetchTransport.dispatch` is the typed streaming core; the low-level handler/backpressure facade is missing.                                    |
| `Dispatcher.request` / top-level `request`   | facade   | Fetch transport and body mixins exist; response-data, trailers and opaque-value facade remain.                                                  |
| `Dispatcher.stream` / top-level `stream`     | missing  | Requires the Node classic writable-stream adapter over the shared response stream.                                                              |
| `Dispatcher.pipeline` / top-level `pipeline` | missing  | Requires the bidirectional Node classic-stream facade and pipeline lifecycle tests.                                                             |
| `Dispatcher.connect` / top-level `connect`   | missing  | Requires a typed tunnel/duplex handoff distinct from ordinary response bodies.                                                                  |
| `Dispatcher.upgrade` / top-level `upgrade`   | provider | Raw WebSocket upgrade exists internally; the general upgraded-duplex facade is missing.                                                         |
| `Dispatcher.compose`                         | shared   | Immutable typed interceptor layers have explicit outer-to-inner request and reverse response/error ordering; the package method facade remains. |
| `Dispatcher.close`                           | provider | H1 and H2 transports close; a common dispatcher-level graceful close remains.                                                                   |
| `Dispatcher.destroy`                         | provider | H1 and H2 can abort active work; common exact-reason async destruction remains.                                                                 |
| connect/disconnect/error/drain events        | missing  | Typed diagnostics/event surface remains; no host `EventEmitter` is used in shared code.                                                         |
| dispatch controller pause/resume/abort       | missing  | Requires explicit body-flow ownership and handler callback delivery.                                                                            |
| informational response callbacks             | provider | H2 preserves informational blocks internally; public `onInfo` delivery remains.                                                                 |
| request-body progress callbacks              | missing  | `onBodySent` and `onRequestSent` remain.                                                                                                        |
| response trailers                            | provider | H1/H2 parse them; public dispatcher response-data exposure remains.                                                                             |
| raw response headers/trailers                | missing  | Requires an exact ByteString-preserving Node facade.                                                                                            |
| `Client`                                     | provider | Strict H1 and prior-knowledge H2 engines exist; the public single-origin client, configuration and stats facade remain.                         |
| `H2CClient`                                  | provider | `Http2Transport` is an explicit h2c/prior-knowledge engine; public class/facade remains.                                                        |
| `Pool`                                       | provider | H1 has bounded per-origin pooling and H2 multiplexes; unified protocol-aware public pool remains.                                               |
| `RoundRobinPool`                             | missing  | Selection, health, stats and lifecycle remain.                                                                                                  |
| `BalancedPool`                               | missing  | Weighted/health-aware upstream management and mutation remain.                                                                                  |
| `Agent`                                      | missing  | Environment-owned origin routing, eviction, limits and public stats remain.                                                                     |
| global dispatcher getters/setters            | missing  | Must be environment-owned, never a process/module global.                                                                                       |
| custom connector / `buildConnector`          | provider | `SocketConnector` is the portable typed connection boundary; Node option/facade and negotiated ALPN metadata remain.                            |
| HTTP/1.1                                     | shared   | Strict streaming parser/writer, pooling, timeouts, cancellation and real-socket tests exist.                                                    |
| HTTP/2 / HPACK                               | provider | Frame, HPACK, multiplexing and prior-knowledge Fetch transport exist; ALPN dispatcher and safe connection coalescing remain.                    |
| HTTP/1.1 pipelining                          | missing  | Must preserve ordered responses, idempotency/blocking controls and cancellation.                                                                |
| H2 prioritization behavior                   | provider | Priority fields are validated; scheduling behavior and provider capability policy remain.                                                       |
| DNS caching                                  | missing  | Typed resolver records, TTL, invalidation and interceptor/provider integration remain.                                                          |
| Happy Eyeballs                               | missing  | Requires provider DNS/address-attempt capability and deterministic race tests.                                                                  |
| protocol-aware stats                         | provider | H2 transport exposes internal counts; stable client/pool/agent stats remain.                                                                    |
| graceful shutdown                            | provider | H1 close and H2 drain exist; environment-wide dispatcher shutdown remains.                                                                      |

## Policy, proxy, cache, and coding APIs

| Undici surface                                    | Status     | NTS mapping or remaining obligation                                                                                                                                          |
| ------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| redirect interceptor                              | shared     | Fetch owns redirect modes, method rewriting, replay and cross-origin credential removal. Dispatcher composition facade remains.                                              |
| decompression interceptor                         | shared     | Shared coding policy drives provider decoders with streaming limits, cancellation and visible original headers.                                                              |
| RFC 9111 cache interceptor                        | shared     | Validators, freshness, `Vary`, invalidation and configured stale policies exist over typed stores.                                                                           |
| memory cache store                                | shared     | `MemoryHttpCacheStore` and the separate `MemoryCacheStorageStore` exist with explicit bounds.                                                                                |
| SQLite/persistent cache store                     | dependency | Durable byte/blob provider primitive and production stores remain; cache policy stays shared.                                                                                |
| retry interceptor / `RetryAgent` / `RetryHandler` | provider   | Typed pre-response/status retry, explicit body replay, backoff, `Retry-After`, abort and observation exist; partial-body Range/ETag resume and exact package facades remain. |
| response-error interceptor                        | provider   | Status-to-error conversion has bounded text/binary capture and stable metadata; canonical JSON object decoding and the exact package facade remain.                          |
| bounded dump interceptor                          | shared     | The shared layer preflights known length, enforces the streaming boundary, waits for cancellation/trailers and preserves network-error identity.                             |
| DNS interceptor                                   | missing    | Depends on the resolver/cache capability above.                                                                                                                              |
| deduplication interceptor                         | shared     | Collision-free safe-request keys, explicit header policy, independent streaming bodies/cancellation and bounded per-subscriber/global fan-out exist.                         |
| tracing/diagnostics hooks                         | missing    | Opt-in typed events must not alter scheduling, ownership or public semantics.                                                                                                |
| `ProxyAgent`                                      | provider   | The JVM/JVM reference transport has HTTP CONNECT; the shared dispatcher integration, authentication, reuse and other providers remain.                                       |
| `Socks5ProxyAgent`                                | provider   | The JVM reference transport has SOCKS5; the shared dispatcher surface, other providers and common corpus remain.                                                             |
| `EnvHttpProxyAgent`                               | missing    | Environment variable parsing, `NO_PROXY` matching and explicit precedence remain Node-only policy.                                                                           |
| injectable proxy authentication                   | missing    | Typed challenge/credential hook, redaction and retry bounds remain.                                                                                                          |
| gzip                                              | shared     | Streaming decode policy and checksum/error tests exist; every production provider still needs evidence.                                                                      |
| zlib/raw deflate                                  | shared     | Both interoperable forms are selected and tested under the same output limits.                                                                                               |
| Brotli                                            | shared     | Coding policy and host reference decoder exist; production-provider evidence remains.                                                                                        |
| advertised encoding control                       | shared     | Only available decoders are advertised; identity is the fallback.                                                                                                            |

## Mocking, replay, and observability

| Undici surface          | Status   | NTS mapping or remaining obligation                                                                                                                                                                                             |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MockAgent`             | facade   | The shared typed agent implements activation, graceful close, bounded body capture/history, network policy and pending assertions; exact Node constructor/dispatcher overloads remain.                                          |
| `MockClient`            | facade   | The shared single-origin client dispatches through its owning mock pool; the exact Undici class hierarchy and Node overloads remain.                                                                                            |
| `MockPool`              | facade   | Shared origin selection and strict per-pool interceptor ownership exist; the package facade remains.                                                                                                                            |
| mock interceptor        | facade   | Shared path/method/body/header/query matching, sequential replies, error identity, abortable delay, persistence/times and default headers/trailers exist; dynamic Node reply overloads remain.                                  |
| `MockCallHistory` / log | facade   | Shared bounded drop-oldest history exposes immutable ordered request records, predicate filtering and clear semantics; exact convenience filters remain.                                                                        |
| mock error taxonomy     | facade   | `MockNotMatchedError` has the stable `UND_MOCK_ERR_MOCK_NOT_MATCHED` code; exact package exports remain.                                                                                                                        |
| `SnapshotAgent`         | facade   | Shared record/playback/update modes, normalization and redaction, strict body/count/total bounds, sequential replies, stable mismatch diagnostics and an injected atomic store exist; the exact Node file-store facade remains. |
| protocol fuzzing        | provider | Focused malformed-wire and sabotage tests exist; persistent fuzz corpora and compiled-provider execution remain.                                                                                                                |
| virtual-time provider   | provider | Host tests use deterministic scheduler injection where relevant; compiled providers need the common environment mode.                                                                                                           |

## Web APIs and helpers exported by Undici

| Undici surface                             | Status   | NTS mapping or remaining obligation                                                                                                                   |
| ------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch`                                    | shared   | Canonical Fetch state machine exists for HTTP(S), data and blob; integrity, negotiated dispatcher and file capability remain.                         |
| `Headers`                                  | shared   | Guards, validation, ordered duplicates, iterators and `getSetCookie()` exist. Dynamic record facade is a typed-API difference.                        |
| `Request`                                  | shared   | Applicable metadata, body/duplex, clone and Web IDL ordering exist.                                                                                   |
| `Response`                                 | shared   | Constructors, statics, body mixin, clone and transport identity exist.                                                                                |
| `FormData`                                 | shared   | Ordered entries, multipart encoding/decoding, files and Web IDL conversion exist. HTML-form construction is browser-only.                             |
| `caches` / `CacheStorage`                  | shared   | Environment-owned public Cache API and typed injectable store exist.                                                                                  |
| cookie helpers                             | shared   | Parser/serializer and typed pair helpers exist; the Node dynamic-record facade remains.                                                               |
| MIME parse/serialize helpers               | facade   | Shared MIME parser/serializer exists internally; exact Undici exports remain.                                                                         |
| `WebSocket`                                | shared   | Client handshake, framing, limits, close races, proxy/TLS path and `permessage-deflate` exist.                                                        |
| WebSocket ping extension                   | facade   | Internal ping/pong exists; public Node helper remains.                                                                                                |
| `WebSocketStream` / `WebSocketError`       | shared   | Canonical shared implementation exists.                                                                                                               |
| `EventSource`                              | shared   | Reconnect, `Last-Event-ID`, timing, limits and real transport path exist.                                                                             |
| Fetch `Cache`                              | shared   | Public Cache/CacheStorage are implemented independently from the HTTP cache.                                                                          |
| `setGlobalOrigin` / `getGlobalOrigin`      | missing  | If exposed, state must be environment-owned and reconciled with the runtime base/origin configuration.                                                |
| `install`                                  | facade   | Provider bootstrap installs canonical identities; compiled TypeScript does not model mutable `globalThis`.                                            |
| global constructor identity                | provider | Shared constructors are canonical; compiled per-environment module/global identity evidence remains.                                                  |
| documented Undici error classes            | provider | Retry, response, response-size, deduplication and mock errors have stable names/codes; the rest of the typed hierarchy and exact Node exports remain. |
| diagnostics channels                       | missing  | Node facade must map typed shared diagnostics without putting `diagnostics_channel` in shared code.                                                   |
| debug logging                              | missing  | Opt-in redacted provider/shared tracing remains.                                                                                                      |
| `util.parseHeaders` / `headerNameToString` | facade   | Strict shared parsing exists internally; exact Node utility shape remains.                                                                            |
| content-type utilities                     | facade   | Shared MIME algorithms exist; exact package facade remains.                                                                                           |

## Required server/mobile extensions beyond Undici's package entry point

| Surface                         | Status     | Remaining obligation                                                                         |
| ------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| capability-scoped `file:` Fetch | missing    | Typed provider, range/metadata behavior, cancellation and path/security policy remain.       |
| persistent `CookieJar`          | shared     | Typed store and policy exist; production durable stores remain.                              |
| provider-backed large Blob/File | shared     | Typed ranged store exists; production spill/durable providers remain.                        |
| WebSocket server                | missing    | Node-only public server reusing the shared frame/extension engine remains.                   |
| mobile lifecycle/network change | provider   | JVM implementation exists in its lane; shared adapter corpus and iOS path remain.            |
| Android OkHttp provider         | provider   | JVM lane owns implementation/evidence; shared semantic integration remains.                  |
| iOS `URLSession` provider       | missing    | Requires a named iOS owner and its own platform floors.                                      |
| HTTP/3/QUIC extension point     | missing    | Stable negotiated capability seam remains; protocol implementation is staged.                |
| canonical ECMAScript JSON       | dependency | Compiler/common-runtime prerequisite; body `.json()` cannot claim compiled completion first. |
| Node `Buffer` adapters          | facade     | Node lane owns exact Buffer conversions over canonical typed memory.                         |
| Node classic-stream adapters    | facade     | Node lane owns readable/writable conversions and the stream/pipeline facade.                 |

## Updating this ledger

Change a status only in the same commit as evidence or in a follow-up evidence commit
that names the implementation revision. When a row becomes **shared**, record the
host/reference corpus and compiler frontier. Promotion to complete requires the real
native, JVM/Android and LLVM/iOS providers; an adapter may not mark a row complete by
delegating Fetch policy to host JavaScript, OkHttp or `URLSession`.
