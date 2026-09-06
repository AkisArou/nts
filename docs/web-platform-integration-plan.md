# Web-platform integration plan

## Status and decision gate

This document is the proposed integration contract for the implementation delivered
separately under:

```text
/home/akisarou/Projects/nts-web-platform-integration/runtime/web-platform
```

It supersedes the earlier architectural suggestions in `docs/fetch-websocket.md`
where this document makes a different decision. The external tree is an
implementation baseline, not a directory to copy without review.

The Node, compiler/common-runtime, and JVM sessions agreed on and fact-checked the
first version of this contract. The repository owner subsequently chose the broader
server/mobile profile recorded below: the WHATWG algorithms remain normative where
they apply, modern standalone Undici is the Node/server reference, Expo and native
platform behavior inform the mobile providers, and temporary compiler gaps do not
reduce the intended surface. All three sessions have now agreed on the revision, and
the compiler/common-runtime and JVM owners have fact-checked the claims in their
lanes against the current tree. **Agreement on this document does not authorize
implementation.** The repository owner will read this signed-off revision and
explicitly authorize each session in that session before work starts.

Until that authorization:

- do not import the external tree;
- do not change compiler, runtime, ABI, or project files for this integration;
- do not treat a peer's relay of permission as authorization; and
- read-only measurement and review are allowed.

## Target

Build a high-quality, strictly typed, production-grade server/mobile Web networking
layer shared by the native Node-compatible runtime, JVM/Android, and LLVM/iOS. The
external tree is a tested starting point, not the target boundary. Integration must
preserve its useful algorithms while replacing its incompatible realm model,
removing duplicate implementations, supplying the compiler/environment/ABI seams it
lacks, and completing the features below rather than repeatedly revisiting an
artificially small networking core.

### Normative and compatibility references

At implementation start, record immutable revisions for all living or moving
references. Do not use an unpinned `main` branch as a conformance claim.

1. The [WHATWG Fetch Standard](https://fetch.spec.whatwg.org/) is normative for
   `fetch`, `Headers`, `Request`, `Response`, bodies, redirects, cancellation, and
   HTTP-network-or-cache behavior wherever those algorithms make sense outside a
   browser document.
2. The [WHATWG Streams Standard](https://streams.spec.whatwg.org/) is normative for
   Web Streams, including byte streams, BYOB readers/controllers, writable and
   transform streams, piping, teeing, backpressure, and async iteration.
3. The [WHATWG WebSockets Standard](https://websockets.spec.whatwg.org/), the base
   WebSocket protocol, and negotiated extension RFCs are normative for client
   WebSocket behavior.
4. The current pinned
   [ECMAScript JSON algorithms](https://tc39.es/ecma262/multipage/structured-data.html#sec-json-object)
   are normative for `JSON.parse`, `JSON.stringify`, raw JSON, reviver/replacer
   traversal, ordering, errors, and primitive conversion within NTS's documented
   static object model.
5. A pinned modern **standalone**
   [Undici](https://github.com/nodejs/undici/tree/main/docs/docs/api) release and its
   applicable tests are the Node/server compatibility reference. Node's bundled
   Undici version is a second pinned compatibility point, not the ceiling: the
   standalone package exposes newer dispatcher, pooling, proxy, cache, mock, retry,
   streaming, EventSource, and protocol facilities.
6. A pinned Expo SDK release, including its public Fetch types and Android/iOS
   native implementations, is the mobile compatibility reference. Expo informs
   useful platform extensions and behavior; it does not override WHATWG semantics
   or force its bridge architecture into NTS.
7. Current HTTP semantics/caching/protocol RFCs and the applicable cookie, proxy,
   content-coding, Server-Sent Events, and WebSocket extension specifications are
   normative below the Web API.

### Complete server/mobile profile

“Complete” means the full standards-derived functionality useful in a standalone
server or mobile application, plus the applicable modern Undici/Expo extensions. It
does **not** mean emulating a browser document, security principal, service worker,
or JavaScript metaobject model. Permanent exclusions are limited to features whose
semantics require those absent browser concepts; missing compiler or provider work
is a dependency and never an exclusion.

The required public and internal surface is:

| Area | Required end state |
|---|---|
| Canonical Web values | `fetch`, `Headers`, `Request`, `Response`, `FormData`, `Blob`, `File`, `URL`, `URLSearchParams`, `DOMException`, `Event`, `EventTarget`, `MessageEvent`, `CloseEvent`, `ErrorEvent`, abort APIs, and text encoders/decoders are one identity-preserving implementation per NTS environment. |
| JSON | Canonical `JSON.parse`, `JSON.stringify`, `JSON.rawJSON`, and `JSON.isRawJSON`; current reviver/replacer/space/source-text behavior; exact string/number/null/boolean/array/object grammar and traversal; ordering, omission, escaping, cycle and error behavior; and direct typed materialization at trusted parse/body boundaries. `Response.json()` and other body mixins use this implementation rather than a Web-specific or host parser. |
| Headers | All specified constructors that are expressible statically, including another `Headers`, ordered name/value iterables, and typed record/dictionary input; validation/normalization, guards, iteration, duplicate ordering, and `getSetCookie()`. Dictionary support uses a real statically representable record shape, not dynamic property enumeration. |
| Bodies and forms | String, `URLSearchParams`, `Blob`/`File`, `FormData`, `ArrayBuffer`, every typed-array/DataView view, `ReadableStream`, synchronous iterable, and asynchronous iterable bodies; Node `Buffer` and classic-stream adapters; streaming upload/download; `arrayBuffer()`, `blob()`, `bytes()`, `formData()`, `json()`, `text()`; MIME handling; URL-encoded and multipart encode/decode; disturbance/locking; cloning/teeing; explicit bounded materialization and clone-backlog policies. |
| Web Streams | Full `ReadableStream`, byte streams, default and BYOB readers/controllers, `WritableStream`, `TransformStream`, queuing strategies, piping, cancellation/abort propagation, teeing, async iteration, and explicit adapters to Node classic streams and native provider I/O. |
| Request/Response/Fetch | All applicable constructors, fields, statics, cloning, redirect modes, credentials metadata, referrer metadata, integrity checks, priority/duplex/keepalive semantics, early hints where exposed, trailers where exposed, abort reasons, and deterministic error mapping. Browser-oriented data fields remain observable where useful even when their browser enforcement algorithm is excluded. |
| Schemes | `http:`, `https:`, `data:`, and `blob:` are required. A capability-scoped `file:` provider extension is required for server/mobile use; unsupported schemes fail deterministically. |
| HTTP protocols | Strict streaming HTTP/1.1 and HTTP/2, including HPACK static/dynamic tables and Huffman coding, ALPN, h2c where the provider/reference exposes it, multiplexing, flow control, prioritization behavior where supported, GOAWAY/draining, connection coalescing rules, framing validation, informational responses, and trailers. HTTP/3/QUIC is a designed and tested provider extension point; it is not required before HTTP/1.1 and HTTP/2 are correct. |
| Connections and dispatch | Undici-like typed `Dispatcher`, `Client`, `Pool`, `BalancedPool`, round-robin pool, `Agent`, global dispatcher, custom connector, `dispatch`, `request`, `stream`, `pipeline`, `connect`, `upgrade`, stats, close/destroy, pool scheduling, pipelining, origin limits, DNS caching, Happy Eyeballs, timeouts, and graceful shutdown. Exact package-level `import "undici"` compatibility is a separate facade decision; the architecture and behavior are required. |
| Policy/interceptors | Composable redirect, decompression, retry, RFC 9111 cache, DNS, deduplication, response-error, bounded dump, tracing/diagnostics, and authentication hooks with explicit ordering and ownership. |
| Cookies | RFC cookie parsing/serialization helpers plus an optional persistent `CookieJar` with domain/path/secure/httpOnly/SameSite/expiry rules. Automatic jar use is explicit policy: no ambient browser cookie store is invented. |
| Caching | Standards-correct HTTP caching with validators, freshness, `Vary`, invalidation, stale policies where configured, memory and persistent stores; and a separate `Cache`/`CacheStorage` API with provider-owned durable storage. Cache behavior must not be accidentally delegated to a platform client. |
| Proxies | HTTP and HTTPS CONNECT proxies, SOCKS5, environment proxy/no-proxy rules on server targets, injectable authentication, and system/PAC proxy integration where a mobile provider exposes it. |
| Content coding | Streaming gzip, zlib-wrapped and raw deflate handling as required by interoperable behavior, Brotli, size/ratio limits, checksum/trailer validation, cancellation, and decompression-bomb defenses. Advertised encodings exactly match available decoders. |
| WebSocket | Complete client handshake and validation, binary/text messages, masking, fragmentation, control frames, ping/pong handling, limits, UTF-8 validation, close races, backpressure and `bufferedAmount`, subprotocols, redirects as specified, TLS/proxy support, `permessage-deflate`, and `WebSocketStream`. A public WebSocket **server** is a required Node/server extension in a separate public module/package; it reuses the shared frame/extension engine and is not exposed on mobile client targets by default. |
| Server-Sent Events | Complete `EventSource`: reconnection, `Last-Event-ID`, field parsing, retry timing, abort/close, proxy/TLS/cache interaction, and bounded buffering. |
| Storage and large data | Memory-backed and provider-backed `Blob`/`File`, slicing, streaming, multipart use, object-URL lifecycle where the target exposes it, and spill-to-disk/durable stores so large payloads are not forced into RAM. |
| Testing and observability | Mock agent/transport, snapshot/replay support, deterministic virtual-time providers, protocol fuzzing, diagnostics hooks, stable error taxonomy, connection/cache/pool statistics, and opt-in tracing without semantic changes. |

For the pinned standalone Undici revision, maintain an explicit API ledger covering
at least `Dispatcher`, `Client`, `H2CClient`, `Pool`, `BalancedPool`,
`RoundRobinPool`, `Agent`, connector/global-dispatcher APIs, `ProxyAgent`,
`EnvHttpProxyAgent`, `Socks5ProxyAgent`, `RetryAgent`, cache interceptors/stores,
`MockAgent`/`MockClient`/`MockPool` and call history, `SnapshotAgent`, stats,
diagnostics, errors, cookies, Fetch, WebSocket, and EventSource. “Architecturally
supported” is not counted as API compatibility: each exported operation/type is
marked implemented, deliberately different, or not applicable with evidence. Expo's
current unsupported Fetch fields are likewise evidence of its present surface, not
permission for NTS to omit integrity, keepalive, mode/referrer metadata, streaming,
cache, proxy, or other applicable profile features.

`SharedArrayBuffer`, `Atomics`, cross-environment transferable ownership, and Workers
are a staged common-runtime project because their memory and concurrency model is
wider than networking. Ordinary `ArrayBuffer` detachment/transfer within its current
specified API, typed arrays, and `DataView` are part of this integration and are
implemented to their full specified semantics now.

The ownership decision needed by the representation is made now: an NTS managed
object never crosses environments. A future `SharedArrayBuffer` has one managed
wrapper per environment over provider-owned shareable backing that is outside the NTS
managed-object/cycle-collector graph and has no outgoing managed edges. On C/LLVM,
only that backing has synchronized cross-environment lifetime ownership; ordinary
object and buffer reference counts remain plain owner-lane operations. On JVM, local
wrappers hold platform-managed shared storage and the platform collector owns its
lifetime. Worker clone/transfer creates or adopts a local wrapper rather than sharing
an `NtsHeader`. The backing is neither immortal nor silently leaked. Element-level
`Atomics` is a separate access problem from backing lifetime.

Cross-environment sharing or transfer of backing occurs only through the reserved
message/completion transport. Posting performs release publication and owner-lane
receipt performs the matching acquire before constructing or adopting the local
wrapper; no wrapper or backing handle is handed to another environment by an
unsynchronized route. On the JVM this happens-before edge makes prior writes visible
under the Java Memory Model. It must be tested on a real weakly ordered ARM device,
not inferred from desktop-x86 success.

That future extension has a known Android-floor conflict, not a presumed free path:
atomic access into shared typed-array backing can use `VarHandle` on a recent JVM,
but Android exposes it only at API 33 while this project targets API 26. An API-26
implementation therefore needs a reviewed alternative such as provider-owned native
atomics or a correct measured locking design, or an explicit owner decision to raise
the floor. `AtomicIntegerArray` cannot alias arbitrary shared byte backing. This
integration establishes the environment-local-wrapper/shareable-backing abstraction,
but it does not select or claim the later element-atomic mechanism without
measurement.

### Intentional browser-only exclusions

The server/mobile profile does not simulate CORS or preflight, opaque filtered
responses, service-worker interception, HTML navigation/document loading, CSP,
mixed-content or Permissions Policy enforcement, browser storage partitioning and
history, DOM-element-derived `FormData`, or document-origin referrer policy. It also
does not implement dynamic Web-IDL/prototype/property-descriptor/global-object
semantics that conflict with the TypeScript non-goals. These exclusions remove
browser embedding policy, not networking capability: redirects, cookies, caching,
proxies, Streams, HTTP/2, compression, WebSocket extensions, and mobile lifecycle
behavior remain required.

## Evidence at the planning baseline

Three labels are used throughout this work:

- **Measured here** means the actual NTS repository, relevant lane, harness,
  machine, and named commit.
- **Measured elsewhere** means useful evidence from a different context, such as
  the external author's host environment or a modified reference program.
- **Argued** means a design or instruction-count prediction that has not been
  measured in the relevant context.

Do not turn an argued result into a performance claim. Do not turn host execution
into evidence that NTS-compiled code runs.

### External implementation evidence

The delivered tree contains 77 files. Its checksum manifest was verified locally
before review. Its recorded results are **measured elsewhere**:

| Check | Recorded result | What it proves |
|---|---:|---|
| Strict TypeScript checks | pass | The shared source can be checked without DOM or Node ambient globals in the author's setup. |
| Node-host tests | 80/80 | The algorithms and Node-host primitive adapter passed the delivered deterministic and live-network tests on Node 22.16.0. |
| Java primitive tests | 11/11 | The delivered Java socket/TLS implementation passed its desktop-JVM tests. |
| Structural TypeScript audit | 31 files, 0 findings | The particular forbidden constructs scanned by that audit were absent. |
| Two unchanged WPT Headers files | 8/9 | Eight assertions passed; dictionary-style `Headers` initialization remained visibly unsupported. |

These runs did not compile TypeScript through NTS, did not run the pinned Node
24.20.0 suite, did not run Android SDK/D8/R8 or a device, and did not run full WPT
or Autobahn. The counts remain useful evidence but are not a definition of done.

### NTS compiler evidence

The JVM owner checked the shared source against repository commit `74b9de9`, with
the incompatible realm/index entry excluded:

| Result | Count |
|---|---:|
| Primary lowering refusals (`NTS1001`) | 179 |
| Cascades (`NTS1003`) | 52 |
| JVM-backend refusals (`NTS4xxx`) | 0 |

Including `realm.ts` did not produce valid HIR: `RealmRequest -> Request` and
`RealmResponse -> Response` violated base-first layout and produced `BrokenBase`.
The 179 messages are not 179 independent features. They include clusters belonging
to the iteration protocol, regular expressions, Promise executor closures, a small
number of representation arms, and several missing declaration walks. Rebaseline
these results at the implementation-start commit rather than assuming the counts are
frozen.

Zero JVM-backend refusals means only that no additional backend diagnostic rejected
the source shapes that reached it. It is not evidence that the current JVM runtime
can carry a socket, accept cross-thread completions, implement the required typed
memory, integrate Android lifecycle, or execute either networking provider. Those
runtime/provider obligations remain unimplemented and require their own compiled and
device evidence.

`JSON` is independently a current language/runtime gap: the TypeScript conformance
ledger lists it under structured built-ins, and no compiler or NTS runtime parser/
stringifier implementation exists at this baseline. Existing `.mjs` tooling and host
bindings call the host JavaScript `JSON`; that is host evidence and cannot satisfy a
compiled `JSON.parse`, `JSON.stringify`, or `Response.json()` path.

### Current typed-array performance baseline

The JVM owner measured these rows under the repository benchmark lock at `74b9de9`:

| Case | NTS JVM | Java | JVM/Java |
|---|---:|---:|---:|
| arrays | 1.42 us | 1.38 us | 1.02x |
| bytes | 752.71 us | 688.08 us | 1.09x |
| elementwise | 61.05 us | 58.46 us | 1.04x |
| node-utf8 | 39.09 us | 7.43 us | 5.26x |

The `bytes` row published at 1.01x in the last full run and measured 1.09x in this
filtered run, with the same binary and machine. That difference is inside the
documented resolution band (roughly eight percent), so there is **no direction
claim**. Any before/after typed-array conclusion must move beyond the resolution of
the relevant row and be repeated in the same context.

The protected current surface includes all eight ordinary numeric typed-array
widths in `examples/typed-arrays`, typed-array subclass examples, and the `bytes`
and `node-utf8` benchmarks. `DataView` and `ArrayBuffer` have no passing example
coverage yet even though `runtime/node` uses them extensively.

## Architecture

```text
Canonical typed Web APIs and server/mobile policy       runtime/web-platform
        |
Fetch/body/cache/cookie/proxy/WS/SSE state machines      runtime/web-platform
        |
Dispatcher + protocol + storage capability contracts    runtime/web-platform
        |
        +-- native Node-compatible H1/H2 provider        runtime/node + runtime/c
        +-- Android production/reference providers       runtime/jvm + Android Java
        +-- iOS production/reference providers           LLVM runtime + Swift/ObjC
        +-- Node-host and deterministic test providers   test/tooling only
```

The shared TypeScript layer owns observable algorithms and state machines. Platform
providers own operations that genuinely cross into an operating system, trust
store, event loop, filesystem/database, compression engine, cryptographic primitive,
or mature platform networking stack. Performance comes from static lowering,
protocol-specialized code, and narrow typed primitives. The design neither moves
all typed policy into C/Java/Swift nor forces every platform through a lowest-common-
denominator socket engine.

The architecture has two transport families behind one typed dispatcher contract:

1. A portable streaming protocol engine provides strict HTTP/1.1, WebSocket framing,
   deterministic in-memory tests, and a reference/fallback path. It is the oracle for
   byte-level and policy behavior and remains usable where no mature platform client
   is appropriate.
2. A production provider may use a mature native client for connection management,
   HTTP/2, QUIC where available, platform trust/proxy policy, lifecycle, and power
   behavior. The shared layer still owns Fetch redirects, cookies, caches,
   decompression policy, errors, cancellation, and public object semantics. Native
   automatic behavior is disabled or explicitly adapted so it cannot silently
   bypass those shared policies.

Both paths must pass the same behavioral corpus. A production provider is not
required to reproduce byte-for-byte wire choices made by the reference engine, but
all public observations within the profile must agree, and every deliberate
provider-specific extension is typed and documented.

| Capability | Native Node-compatible | Android/JVM | iOS/LLVM |
|---|---|---|---|
| Production HTTP | Shared compiled H1/H2 dispatcher over typed libuv/native DNS/TLS primitives; no host-JS delegation | Reviewed OkHttp-based provider is the leading design; portable `ByteConnection` remains the deterministic reference/fallback | Reviewed `URLSession`-based provider is the leading design; portable `ByteConnection` remains the deterministic reference/fallback |
| HTTP/3 | Stable QUIC provider seam; implementation may follow after H1/H2 | Provider capability, version/API dependent; never required for semantic correctness | `URLSession` may negotiate it opportunistically; never relied on by shared semantics |
| TLS/trust | Native trust configuration, SNI, ALPN, hostname verification, client certificates | Android trust manager/network-security policy, SNI/ALPN, hostname verification, client certificates | Apple trust evaluation, ATS/platform policy, SNI/ALPN, client identity |
| Proxy | Explicit HTTP/CONNECT/SOCKS/env providers | Explicit proxy adapter plus Android/system behavior where selected | Explicit proxy adapter plus system/PAC behavior where selected |
| Persistent cache/storage | Provider interface with filesystem/SQLite implementation | Provider interface backed by Android-appropriate durable storage | Provider interface backed by Apple-appropriate durable storage |
| Scheduling/lifecycle | Owning NTS/libuv environment | Owning NTS environment plus Android lifecycle/network-change integration | Owning NTS environment plus application/background/network-path integration |
| Compression | Native reviewed streaming decoders | JVM/Android reviewed streaming decoders or platform adapter | Compression framework/platform decoders behind the same coding contract |
| Node-specific adapters | `Buffer`, classic streams, diagnostics, dispatcher/package facade | None | None |

The canonical Fetch/Web/Streams/cache/cookie/WebSocket/EventSource APIs and their
observable semantics are shared across all three targets. The advanced dispatcher
contract is shared internally so providers are interchangeable; its exact Undici
public names, Node classic-stream/`Buffer` adapters, diagnostics-channel mapping,
environment-proxy defaults, and public WebSocket server are Node/server surfaces.
Android/iOS instead expose typed lifecycle, system-network, trust, and durable-store
configuration through mobile provider options; those options do not fork the Web
object model. A portable explicit proxy and cache configuration remains available on
all targets even when a mobile system adapter also exists.

The native durable-storage ABI is deliberately narrow: a typed namespaced byte/blob
store with streaming read/write, atomic commit/replace, delete, typed enumeration,
metadata and size accounting, bounded concurrency, cancellation, crash recovery and
close. Provider implementations may use files or a database. RFC 9111 freshness,
validation, `Vary`, invalidation, eviction, quota policy, CacheStorage matching and
serialization formats are shared TypeScript algorithms in the Node-owned layer, not
native “storage primitives.” Mobile platform owners supply the same capability below
their providers.

The Node-host adapter may use `node:net`, `node:tls`, `node:crypto`, timers, and zlib
as test primitives. It must not delegate production Fetch/WebSocket semantics to
host `fetch`, host `WebSocket`, Undici, `node:http`, or `node:https`. The native
Node-compatible provider is separate and must use the NTS environment and native
ABI; passing Node-host tests does not implement that provider.

## Canonical ownership and deduplication

There will be one canonical implementation of each Web value. `runtime/node` imports
and reexports the canonical value exactly. It must not preserve compatibility by
wrapping, copying, subclassing, rebinding, or manufacturing a second constructor.

| Surface | Final ownership and action |
|---|---|
| `URL` and live `URLSearchParams` | Promote/refactor the existing typed `runtime/node/url` implementation into shared ownership. Remove the external reverse adapter and its simplified divergent parser. Node reexports the shared constructors. |
| `Blob` and `File` | Start from the richer existing Node implementation, promote its platform-independent storage and semantics into shared ownership, and reconcile external multipart/body needs there. Node object-URL registration remains Node-specific. |
| `TextEncoder`, `TextDecoder`, and encoding streams | Strengthen the external typed UTF-8 implementation as the shared canonical implementation, complete the required encodings/stream transforms for the claimed surface, and have Node `util` reexport the same values. |
| `Event`, `EventTarget`, `MessageEvent`, `CloseEvent`, abort APIs | Use the external typed implementation as a starting point and reconcile it with existing Node listener/error behavior. Node modules reexport the same constructors where Node does. Fix strong-parent retention for long-lived `AbortSignal.any` use; do not hide it behind a host weak-reference fallback. |
| Web Streams | Shared full Web Streams implementation, distinct from Node classic streams. Node adapters bridge explicitly rather than confusing the two stream models. |
| `Headers`, `Request`, `Response`, `FormData`, Fetch, WebSocket, `WebSocketStream`, `EventSource`, Cache APIs | New shared canonical implementations based on the external tree and normative references, refactored to project conventions and completed to the profile above. |
| Dispatch, protocols, pools, policy | Share types and observable algorithms. Keep the strict portable engine as reference/fallback; allow production platform transports behind the same contract. Do not merge with Node's public `http` merely because both speak HTTP; deduplicate codecs or validation only where their policy is identical. |

Identity tests must cover every surface exposed both globally and from a Node module,
including at least `Blob`, `URLSearchParams`, `TextEncoder`, `TextDecoder`,
`WebSocket`, `CloseEvent`, and `MessageEvent` where the pinned Node version exposes
them.

## No synthetic API realms and no compiled `globalThis`

Delete/refactor the external `realm.ts` before the imported tree becomes a root
project or NTS entry point. Per-call `RealmRequest`, `RealmResponse`, and sibling
constructor families conflict with base-first layout, create the wrong identity,
and attempt a realm/prototype model that is a permanent Section 13 non-goal.

This rejects the external implementation's **synthetic per-runtime subclasses**; it
does not reject isolation. In browser terminology, a realm couples a global object,
intrinsic/prototype families, and execution context. NTS intentionally does not
model the dynamic global/prototype half. It still needs multiple isolated execution
environments for embedders and Workers. Each Worker owns an `NtsEnvironment`, event
loop, Web-platform runtime, native resources, and canonical constructor/export
wrappers. Values cross that boundary only through an eventual typed structured-clone
and transfer protocol; a Worker is not implemented by constructing `RealmRequest`
and `RealmResponse` subclasses for each call.

The replacement is:

- top-level canonical classes and functions;
- a `WebPlatformRuntime` instance containing transports, policy, scheduler,
  connection pools, open sessions, and `close()` state; and
- explicit clients/runtime instances in tests when isolation is needed.

There is one semantic top-level constructor family per compiled process today because
the common environment seam is missing. The target is one identity-preserving family
per environment, backed by the same compiled implementations. Provider wrappers are
environment-local because values such as `napi_value` cannot cross environments; a
global and module reexport in one environment must be the exact same value, while
distinct Worker environments are intentionally distinct identities.

Bootstrap is provider code outside compiled TypeScript. A standalone native
executable installs its statically known globals through the native environment
bootstrap. A Node-host addon test/embedding may instead create environment-local
N-API wrappers. JVM/Android and LLVM/iOS expose the same canonical symbols through
their provider bootstrap. Shared compiled TypeScript imports and reexports them
directly. It does not read, enumerate, index, or assign a mutable global object.
`globalThis` as a value remains a Section 13 non-goal; this integration does not
introduce a property map or metaobject protocol.

`bindings.node.mjs` or equivalent host glue may load the generated addon, expose
writable CommonJS properties, and perform provider bootstrap. It is glue, not the
implementation of Fetch, WebSocket, HTTP, or Web classes, and it must not become a
host-delegation escape hatch. This boundary already matches the repository: 327 of
360 `globalThis` assignments are in host `.mjs` files, while zero are in compiled
TypeScript.

## Environment and event-loop contract

The present C runtime and JVM loop both hold semantic state in process-wide/static
storage. The C runtime has file-scope host, queue, depth, allocator, and collector
state; a second `nts_host_install` silently overwrites the first. The JVM loop has
static queues/depth/time and no cross-thread completion entry. These are two symptoms
of the same missing common-runtime environment seam.

The common environment contract is:

1. An environment owns its host capabilities, task/microtask queues, recursion
   depth, external-work liveness, close state, and Web-platform runtime. Allocation
   and collector roots are environment-owned where the provider has them. `NoGc`
   has no NTS collector roots on either lane: the JVM relies on the platform
   collector, while the C `NoGc` provider is a bump allocator that never frees and
   must not be selected silently for a general application. Its allocator state is
   still environment-owned.
2. Exactly one owner lane mutates ordinary environment state. Foreign I/O threads
   may only publish reserved completions and hold provider-owned environment
   lifetime; they never invoke TypeScript directly. Cross-environment messages and
   backing transfers use this synchronized publication path as well, with release on
   post and acquire on receipt.
3. Host entry, exported-function entry, and callback delivery use a scoped
   enter/leave operation for the current environment. Delivery performs the
   owner-lane microtask checkpoint required by the language semantics.
4. External liveness is acquired before work is launched and released exactly once
   when that work is delivered, cancelled, or dropped during close. Close rejects
   new work and safely handles late completions.
5. A standalone provider may construct one default environment, but ABI and
   semantic data are not process-global. The mechanism by which generated/runtime
   code finds or captures its environment is provider-owned and measured; the
   contract does not prescribe TLS, `ThreadLocal`, threaded parameters, or frame
   fields. Scoped state must be restored/cleared on leave and close so an owner
   thread cannot retain a closed Android environment.
6. An environment chooses a time mode at construction. Deterministic oracle tests
   use virtual time. Real external-I/O liveness tests use a monotonic clock. Every
   test states its mode; network activity never silently advances virtual time.
7. Immutable process-wide tables are permitted; mutable diagnostic counters are
   per-environment. A process-wide diagnostic query sums environments at a defined
   safe point, preserving the memory harness and differential leak detector without
   adding an atomic/locked instruction to every allocation, retain, or release. No
   counter or object reference count becomes atomic: exactly one owner lane touches
   an environment's heap, and managed references never cross environments. A
   concurrent diagnostic snapshot must coordinate with owner lanes rather than race
   their plain counters. Diagnostics never affect program semantics, ownership,
   scheduling, capabilities, lifecycle, or close. The existing 61 memory cases,
   eight C runtime tests (of 13 test files), and differential leak check keep their
   process-wide observation contract through aggregation on read.

The environment seam therefore enforces an existing performance premise rather
than adding a new one: `nts_retain` and the diagnostic hot paths already use plain,
non-atomic increments on the RFC 17.1 assumption that one runtime owns its heap. The
environment and owner-lane invariants make that assumption mechanically true.

This extends an existing `NtsTask` ownership rule rather than inventing an unrelated
one. A queued task owns its managed state/closure reference, and every host must
eventually run or drop it. A one-shot task consumes that ownership when it runs; a
repeating task holds it across invocations and returns it only when dropped. Releasing
a repeating callback after each invocation can free it underneath the still-active
handle while leaving aggregate traces apparently balanced, so this rule is part of
correctness rather than an implementation detail. The current JVM timer already
follows it: its timer object retains the callback for the handle lifetime and removes
the timer/callback references on terminal retirement. Tests protect that behavior
from a future per-invocation-release "optimization."

### Completion reservations

A bounded completion inbox is a correctness requirement, not merely a memory
optimization:

1. Reserve completion storage/credit before launching one-shot work or arming a
   repeating source. Allocation is permitted while reserving. If credit is not
   available, reject, delay, or apply platform backpressure before OS work exists.
2. Posting a completion against a valid reservation is nonblocking and cannot fail,
   drop, allocate, or create unbounded hidden storage. This specifies *when* storage
   is acquired without prescribing an array, ring, or linked data structure.
3. One-shot work reserves one completion credit, acquires one liveness unit, and
   owns the callback reference required to deliver it. Delivery, cancellation, or
   close-time drop returns all three obligations exactly once. Running the one-shot
   callback consumes its callback ownership under the existing `NtsTask` rule.
4. Every repeating API specifies an observable backlog rule matching Node/the
   relevant standard. Intervals coalesce missed deadlines and rearm rather than
   replaying every missed tick. A non-coalescible event stream uses an explicitly
   bounded credit window and platform backpressure; queue policy is never selected
   merely for implementation convenience. A repeating handle holds one liveness
   unit and its callback reference for its lifetime, not one per notification; only
   terminal close/cancel/drop returns them.
5. Close stops new reservations, retires repeating sources, drains or explicitly
   drops already-reserved completions, and returns every completion credit,
   liveness unit, and callback reference. A zero liveness count alone is not proof
   that callback ownership or reserved storage was returned.
6. Saturation tests must prove normal progress. A sabotage test deliberately breaks
   the credit/release invariant and must fail or time out. This depends on preserving
   the differential harness's distinct `TimedOut` verdict; a timeout must never be
   reclassified as a clean refusal/decline. A separate memory/lifetime sabotage
   releases a repeating callback per event instead of at terminal drop and must be
   caught by an observation at the lifetime boundary rather than relying on a crash
   or AddressSanitizer. The `TimedOut` verdict is a contract owned by the JVM/
   differential lane and may not be reclassified without first replacing every
   sabotage assertion that depends on it with an equally visible failure signal.

Reference-count arithmetic is not a cross-provider proof of retirement. A provider
that does not emit reference counting—the JVM lane and the C lane under `NoGc`—has
no retain/release evidence to inspect. JVM callback ownership and completion-storage
retirement are verified through reachability: retain a weak reference in the test,
close the source and environment, force/await collection under a bounded test
protocol, and assert that it clears. C `NoGc` never frees its bump allocation and
therefore cannot prove deallocation or balanced ownership; it verifies functional
source/task retirement, while the corresponding ownership proof runs under the C/
LLVM reference-counting provider. An empty provider-specific diagnostic-counter set
never means there is no ownership invariant to verify.

## Typed arrays, `ArrayBuffer`, and `DataView`

The current lowering deliberately gives a typed array no representation of its own:
it reuses the owning `ManagedType::Array` representation with an explicitly written
element width. Descriptors, bounds checks, escape analysis, and reference counting
therefore inherit owning-array assumptions, and the three backends match that variant
in 97 places at the planning review. On the JVM, `Uint8Array` is currently an `int[]`,
with four times the storage expected at a byte ABI and no shared
`buffer`/`byteOffset` model. `subarray`, `slice`, and `set` are refused in the external
source. This is a compiler/runtime representation project, not a small added field;
source-level offset arithmetic or forced copies are not acceptable workarounds.

The new semantic contract is:

- ordinary `Array<T>` keeps its existing inline, 16-byte-aligned representation;
- `ArrayBuffer` has the specified fixed/resizable state, byte length and maximum,
  slicing, resize/transfer/transfer-to-fixed-length, and detached-buffer behavior;
- typed arrays use a distinct view representation and cover `Int8Array`,
  `Uint8Array`, `Uint8ClampedArray`, `Int16Array`, `Uint16Array`, `Int32Array`,
  `Uint32Array`, `Float16Array`, `Float32Array`, `Float64Array`, `BigInt64Array`,
  and `BigUint64Array`;
- all views of an `ArrayBuffer` observe one shared backing and alias exactly;
- ordinary `ArrayBuffer` backing belongs to one environment; a future
  `SharedArrayBuffer` uses the environment-local-wrapper/provider-shareable-backing
  split fixed in the Target section, so no NTS managed reference crosses an
  environment boundary;
- native C/LLVM backing returned for typed views begins at an address aligned to at
  least 16 bytes. Managed providers must document and measure the effective alignment
  of the representation they choose rather than assume a native address guarantee;
  any native pointer they expose obeys the same minimum;
- `byteOffset`, `byteLength`, `buffer`, `subarray`, overlapping `set`, and isolating
  `slice` have their specified observable behavior;
- construction from lengths, buffers/offsets/lengths, arrays, array-like values and
  iterables; static `from`/`of`; numeric conversion/clamping; alignment/range checks;
  iteration; sorting; searching; copying; reversal; and all other applicable typed-
  array methods follow the current ECMAScript specification rather than a network-
  only subset;
- the backing lifetime is provider-owned: C/LLVM may use native ownership while JVM
  uses ordinary collector references and never introduces a second NTS GC;
- all typed widths and both numeric domains currently used by the repository remain
  correct, including half-precision conversion, NaN/signed-zero, clamped stores, and
  64-bit BigInt array/DataView wrapping and round-trips;
- a user class extending a typed array remains one object and may add fields/methods
  while preserving base-first layout; and
- `DataView` implements every specified numeric/BigInt getter and setter with exact
  endian, offset, bounds, conversion, detachment, and resizable-buffer behavior.

Backing lifetime is independent of wrapper usability. Detaching, transferring, or
shrinking a wrapper takes effect synchronously for TypeScript exactly as specified,
but it does not revoke memory already borrowed by a provider operation. The backing
is released only after the last live wrapper and last provider borrow are both gone;
completion/cancel/drop returns the borrow exactly once. This is the same external-
backing seam used for future sharing, not a second pinning architecture.

BYOB Streams are part of the typed-memory ABI, not merely a Streams convenience: a
caller-provided view is written through with exact offset/length accounting, and the
specified buffer transfer/detachment and returned-view behavior must be preserved.
Providers may borrow/pin only for the documented operation lifetime and may not
silently substitute a copy that breaks observable aliasing or detachment.

`SharedArrayBuffer`, growable shared buffers, and `Atomics` are not faked with
ordinary buffers. They land with the common Worker/concurrency memory model. The
representation and public type hierarchy chosen now must admit that extension while
keeping non-shared access free of unnecessary atomic operations.

Four typed arrays absent from the current lowering become explicit dependencies,
not aliases: `Uint8ClampedArray` needs its specified clamping/rounding conversion,
`Float16Array` needs correct binary16 conversion, and the two BigInt arrays depend on
the existing `bigint` representation. NTS `bigint` is currently a documented signed
128-bit value rather than JavaScript's arbitrary-precision integer. That divergence
remains explicit; this profile requires exact 64-bit typed-array/DataView conversion
and wrapping within the supported domain and must not claim arbitrary-precision
BigInt conformance.

The element type cannot distinguish the new representation: an integer-only
`number[]` may narrow to `i32`, which is also the element representation wanted by
`Int32Array`. HIR must carry owning array versus typed view as an explicit semantic
distinction and re-establish descriptors, bounds checks, escape analysis, and
ownership for the new variant while preserving ordinary-array layout and behavior.

The contract deliberately does not prescribe `byte[]`, `ByteBuffer`, a native C
layout, or compiler-synthesized wide loads. Each provider chooses and measures its
mechanism. On the JVM, direct byte storage, synthesized wide access, and selected
helpers are candidates, not decisions. Instruction counting such as “eight byte
loads for a `Float64Array` element” is **argued**, not a benchmark.

Backing alignment cannot make every view aligned: for example, a valid
`Float64Array` beginning at byte offset 8 is eight-byte aligned but not 16-byte
aligned. The C runtime records a historical 33% `elementwise` penalty when double
storage began at the corresponding eight-byte boundary; that is **measured
elsewhere for this candidate**, not a current before/after result. Benchmark aligned
and every spec-valid misaligned-offset class separately in `bytes`, `elementwise`,
`node-utf8`, and provider byte paths so this known slower regime is never rediscovered
as an unexplained regression.

Before choosing and landing a representation, record the distinct current floors at
`74b9de9`: LLVM 113, LLVM-RC 113, and JVM 112 in the backend gate; 41
`bench-agree` cases; and 61 memory cases. The separate examples step has no numeric
floor: every comparable example must agree, so its requirement automatically scales
with the corpus. There are 124 example directories at this baseline, which is not
itself a lane floor. A direct planning-time JVM run found 112 of 113 comparable
examples agreeing; `async-finally` is the sole miss and needs the known
`nts_promise_reject_value` JVM runtime helper plus its fixed-external entry, not a new
design. Also record all typed-array examples across four lanes, `bytes`,
`elementwise`, `node-utf8`, and applicable `runtime/node` uses. After the change:

- all existing floors remain green;
- add `ArrayBuffer` and `DataView` examples;
- test all 256 byte patterns, signed and unsigned loads, every supported width,
  nested/aligned/misaligned offsets, cross-view mutation, slice isolation,
  overlapping `set`, and ABI transfer/borrow lifetimes; and
- add sabotage proving that breaking aliasing makes the suite red, plus detachment
  and resize during an outstanding native write so premature backing release cannot
  pass silently.

Take before/after performance measurements under the exclusive lock only after the
candidate is stable. No provider mechanism is selected from an unmeasured prediction.

## Compiler and common-runtime prerequisites

These dependencies are in scope. Shared source is written in its intended final
form; it is not distorted to avoid a temporary compiler limitation.

1. **Environment seam.** Replace process-global semantic runtime state with the
   environment contract above across C/LLVM and JVM entry/callback paths. Move
   diagnostic counters into environments and preserve the process-wide harness view
   by aggregation on read at a safe point.
2. **Typed-memory representations.** Add an explicit common HIR/runtime distinction
   between owning arrays, ordinary buffer/view objects, and future environment-local
   wrappers over shareable backing. Audit the 97 current `ManagedType::Array` matches
   and re-establish descriptors, bounds checks, escape analysis and ownership for
   views. Preserve ordinary-array layout/behavior; do not attempt to infer the
   distinction from element type.
3. **Typed callback trampolines.** Generate one trampoline per callback signature.
   The trampoline is the call itself; an `NtsTask` is only cross-thread transport.
   The compiler owns the closure slot and environment entry, so neither is guessed
   or smuggled through an undeclared ABI argument.
4. **General class/interface representation and values.** Extend the existing
   immortal constructor-token model beyond the currently provided error classes so
   canonical Web classes can be used and reexported with exact identity. Also carry
   ordinary class/interface types used in parameters and state, including the
   `ReadableStream`, reader/source, tee-state/branch, and event types that account for
   20 occurrences in the planning refusal inventory; these are not
   iteration diagnostics.
5. **Iteration protocol.** Complete the planned synchronous/async iteration,
   generator, and stream-related lowering needed by the final source. In the external
   planning inventory, iteration proper accounts for 13 refusal occurrences across
   six diagnostic shapes, not roughly thirty independent messages. Ordinary
   iteration is not a Section 13 exclusion.
6. **Regular expressions.** Complete the existing AOT-compiled-regexp project using
   the vendored matcher design. At `74b9de9`, `runtime/node` alone contains 17
   distinct sites and 86 occurrences, and the external source adds seven. Replacing
   patterns with bespoke parsers only to make this package lower is not acceptable.
7. **Promise executor closures.** Permit the real captured resolver/executor shape;
   do not substitute a special Web-only promise API.
8. **Remaining lowering arms.** Close the measured nullable/absence representation,
   conditional, array-literal, declaration-walk, and method-shape gaps and record
   exact diagnostics as they move.
9. **JSON and trusted typed materialization.** Implement the canonical ECMAScript
   parser/stringifier once for all targets; complete reviver, replacer, spacing,
   `toJSON`, raw JSON, key ordering, omission, escaping, numeric edge, cycle and error
   semantics that are meaningful in the static profile. Associate the standard
   declarations and `Body.json()` with compiler-owned `JsonParse` boundary metadata,
   as designed in `docs/any-unknown.md`, rather than hardcoding API names in the core.
   A directly consumed `JSON.parse(text) as T` or typed response boundary may generate
   a checked parser that materializes `T` without first allocating and walking a
   generic object graph. A generic result uses an erased tagged JSON graph that can be
   carried, narrowed, validated, reviver-transformed and stringified, but it does not
   introduce arbitrary ordinary-object property maps, prototype behavior, or
   unchecked `any` into HIR. Standard signatures and error behavior remain visible;
   no Web-only parser, host delegation, unchecked cast, or mandatory second traversal
   is accepted as the final architecture.

   Parse and stringify traversal must not recurse on the provider thread stack; both
   use an explicit work stack so a provider stack does not choose observable
   behavior. For parsing, the planning Node reference accepted at least one million
   nested array levels, so there is no recursive-stack-sized Node limit to copy. If
   NTS nonetheless selects a finite parse limit, it is a documented compatibility
   divergence with its own conformance row. Every resource limit is one documented
   provider-independent value with the same exception on every lane. Deep input must
   never become a JVM `StackOverflowError` on one target and a C/LLVM signal death on
   another.

   JSON number emission calls the same canonical `Number::toString` implementation
   used by `String(number)` on each provider; on C/LLVM that is the existing
   `nts_grisu.h`/`js_dtoa` shortest-round-tripping path, and on the JVM it is
   `NtsRuntime.numberToString`, backed by the `NtsGrisu` port—not a second formatter.
   The remaining JSON-specific numeric cases include non-finite values stringifying
   to `null`, negative zero stringifying as `0`, overflow such as `1e400`, and
   precision past 2^53.

   Parsing and escaping operate on JavaScript UTF-16 code units. Lone surrogates such
   as `\uD800` remain representable when parsed and are escaped correctly when
   stringified rather than being normalized through UTF-8 to U+FFFD. The well-formed
   surrogate predicate is shared with `String.isWellFormed`/`String.toWellFormed`;
   the stringifier must not grow a private scan that the string built-ins later
   duplicate. A generic JSON object preserves the `OrdinaryOwnPropertyKeys` order
   required by round-trip traversal and stringify: canonical array-index names from
   `0` through `2^32 - 2` come first in ascending numeric order, followed by all
   other string keys in insertion order. An unordered hash map or plain insertion-
   ordered map is not a conforming object case even if lookup is correct; names such
   as `"01"`, `"-1"`, `"1.5"`, and `"4294967295"` remain in the string-key bucket.

   The generic erased JSON graph necessarily materializes storage proportional to
   its data on the current JVM, while direct checked materialization can avoid
   per-node erased wrappers; direct typed materialization is therefore the primary
   architecture, not an optional late optimization.

`globalThis` is intentionally absent from this list. Provider bootstrap supplies
statically known globals outside compiled TypeScript, preserving the existing
Section 13 boundary.

### Native call ABI and its cost model

TypeScript lowered through C or LLVM is native code. Calling across a TypeScript/C
source boundary is therefore not a JavaScript bridge and does not inherently require
N-API, a Worker, serialization, copying, or allocation:

```ts
declare function nts_socket_write(fd: number, bytes: Uint8Array): number;

export function send(fd: number, bytes: Uint8Array): number {
  return nts_socket_write(fd, bytes);
}
```

Conceptually, the native ABI is a direct symbol call carrying the view explicitly:

```c
int32_t nts_socket_write(NtsEnvironment *env,
                         int32_t fd,
                         const uint8_t *data,
                         size_t length);
```

Calling a top-level compiled TypeScript function from C is likewise a direct call;
the external entry only establishes the owning environment:

```ts
export function onConnected(status: number): void {
  // Compiled as an ordinary native function.
}
```

```c
NtsEnvironmentScope scope = nts_environment_enter(env);
nts_export_on_connected(status);
nts_environment_leave(&scope);
```

A captured TypeScript callback is different because its runtime value contains both
code and captured state and its argument/result signature matters:

```ts
export function start(prefix: string): void {
  nts_connect((status: number, address: string): void => {
    console.log(prefix, status, address);
  });
}
```

The compiler therefore emits a typed indirect-call trampoline for that exact
signature. Conceptually:

```c
typedef struct NtsConnectClosure NtsConnectClosure;

static void nts_call_connect_closure(NtsEnvironment *env,
                                     NtsConnectClosure *closure,
                                     int32_t status,
                                     NtsString *address) {
  NtsEnvironmentScope scope = nts_environment_enter(env);
  closure->call(closure, status, address);
  nts_microtask_checkpoint(env);
  nts_environment_leave(&scope);
}
```

The trampoline is normal typed native indirection and should allocate nothing per
invocation. If native code completes on a foreign thread, it must reserve a
completion and post it to the owner lane first. That hop is required by environment
and event-loop ownership, not by the source languages. On the JVM, the corresponding
same-thread calls are ordinary typed method/interface calls and may be inlined, but
captured state, lifetime, environment entry, and foreign-thread delivery still have
the same semantic obligations.

## Native Node-compatible provider and Node-host N-API boundary

The native provider implements the shared ports through the existing NTS host and
libuv/native facilities. It does not run a Worker, create a hidden event loop, call
back on an I/O thread, or delegate to a host JavaScript implementation.

Required native primitives include:

- TCP and DNS with partial reads/writes, EOF, cancellation, and bounded work;
- TLS with SNI, certificate-chain and hostname verification, minimum-policy handling,
  native trust configuration, ALPN for HTTP/1.1 and HTTP/2, client identities, session
  reuse, and clean shutdown;
- secure randomness suitable for WebSocket masks and multipart boundaries;
- monotonic scheduling integrated with the active environment;
- nonblocking byte connections, TLS ALPN/session information, cancellation and wakeup
  primitives sufficient for the shared compiled HTTP/1.1/HTTP/2/HPACK/dispatcher/
  proxy engines; an optional native fast path must pass the same semantics before use;
- gzip, zlib-wrapped/raw deflate and Brotli streaming primitives used by shared
  content/WebSocket codings, plus storage primitives required by persistent caches
  and large blobs; and
- explicit byte ownership: reads transfer stable owned bytes, writes borrow/pin a
  view until terminal completion, and every offset is accounted for exactly once.

Before changing callback codegen, the Node owner produces a checked, deduplicated
inventory of the native declarations (currently about 128) grouped by exact callback
signature and lifetime. The ABI then follows these rules:

- one-shot callback handles own their closure until terminal delivery or cancel,
  then release exactly once;
- repeating callback handles retain until handle close/cancel;
- invocation borrows the closure;
- drop/cancel is idempotent; and
- every trampoline captures/enters the correct environment and performs the required
  owner-lane checkpoint.

No generated constant guessed from object layout, invisible extra argument, generic
`void()` callback cast, or handwritten signature switch is accepted as the long-term
ABI.

N-API is **not** the transport by which the standalone native runtime calls its own
C primitives, and shared Fetch/WebSocket code does not execute “through N-API.”
N-API is used only at the outer Node-host boundary when a test or embedding loads
NTS-compiled code as a `.node` addon. There it converts host JavaScript values to the
typed native ABI, establishes the addon environment, and converts results back. The
standalone executable has no N-API layer at all. Tests and documentation must label
these two paths separately:

```text
standalone: compiled TypeScript -> direct native ABI -> libuv/TLS/protocol provider
Node host:  JavaScript -> N-API addon wrapper -> same compiled/native implementation
```

## JVM and Android provider

There is no general Java binding facility today. TypeScript cannot name arbitrary
Java methods, and this project will not invent a broad `nts bind` feature merely to
connect networking. The agreed boundary is a small typed runtime-owned intrinsic
table (`nts_jvm_web_*` conceptually) whose TypeScript declarations state the real
ABI. This is the same fixed-external mechanism used by other runtime primitives,
not an inverted-control workaround.

The JVM owner supplies:

- fixed typed intrinsic descriptors for environment, object, callback, and byte-view
  arguments after their common types exist;
- stable `nts.rt` callback interfaces that matching generated closure classes
  implement, so Java-to-TypeScript calls do not name generated hash classes;
- an environment-instance loop, thread-safe wakeup/inbox, liveness and completion
  reservations, virtual/monotonic time modes, and owner-lane callback delivery;
- a production Android dispatcher built around a reviewed, pinned OkHttp release,
  subject to dependency/license/API-floor/supply-chain review, plus the delivered raw
  `Socket`/`SSLSocket` `ByteConnection` path as deterministic reference/fallback;
- explicit adapter control over redirects, cookies, caching, decompression,
  retry, errors and cancellation so OkHttp cannot silently replace shared policy;
- HTTP/2, platform pooling, proxy and connection facilities exposed only through the
  typed dispatcher capabilities actually negotiated by the provider;
- certificate validation, explicit HTTPS endpoint identification, SNI, Android
  cleartext-policy checks, secure randomness, deadlines, cancellation, and bounded
  executors; and
- provider byte-view transfer/borrow behavior matching the shared ownership ABI.

NTS-owned Java source lives with and is owned by the JVM lane from its first
repository commit; it is not an adapter subtree inside the shared TypeScript
runtime. Its own jar keeps the existing ratchets: byte-for-byte reproducible build,
Java 8/class-file version 52, zero
`invokedynamic`, Android API 26 compatibility, and warnings/errors enforced. The
zero-`invokedynamic` rule protects NTS-owned Java from silently depending on newer
compiler output; it is not a ban on bytecode that Android's D8 toolchain can desugar.

OkHttp 4/5 is Kotlin-built and brings at least Okio and `kotlin-stdlib`; this is a
material dependency and runtime-size/maintenance decision even if the NTS adapter is
written in Java. The selected release and transitive closure are locked, licensed,
SBOM-recorded, and verified by cryptographic hashes. Reproducibility is split
honestly: the NTS-owned jar remains byte-identical from source; third-party artifacts
are immutable verified inputs obtained through the repository's reviewed dependency
mechanism; and the combined release is verified after D8/R8 under a pinned Android
toolchain. Third-party jars are checked for their declared minimum platform and at
the DEX/device level rather than rejected merely for containing `invokedynamic`.

Plain `Inflater` does not decode the gzip wrapper. The portable Android/JVM path
therefore requires a streaming gzip header/trailer state machine around raw
inflation, including CRC32 and ISIZE validation, or another reviewed streaming
primitive with equivalent behavior. Zlib-wrapped deflate is separate. A production
OkHttp/platform decoder may satisfy a coding only when streaming, cancellation,
limits, validation, and shared header/error semantics are demonstrated. Do not
advertise `gzip`, `deflate`, or `br` on a provider until that coding is actually
decoded correctly; request `identity` otherwise.

OkHttp's automatic behaviors are configured explicitly: both redirect modes off,
`CookieJar.NO_COOKIES`, no installed cache, retry-on-connection-failure off, and an
explicit protocol list. The shared layer always supplies `Accept-Encoding`; otherwise
OkHttp may add gzip itself, transparently decode, and strip `Content-Encoding` and
`Content-Length`. A mandatory cross-adapter differential asserts identical exposed
coding and length headers for compressed and uncompressed responses, so forgetting
that control fails visibly rather than becoming a provider-specific observation.

Java callbacks are always asynchronous relative to the initiating call and always
delivered on the owning NTS lane. Shutdown first stops new work, then cancels and
settles platform operations, drains/drops their reserved completions, closes pools
and sessions, and only then releases the completion executor/environment. Late
success after abort is closed and discarded without entering a dead environment.

The reference adapter is not allowed to rot behind the production adapter. When the
two-adapter corpus first lands, record its exact applicable-case count as a ratcheted
floor that may only rise; additionally require every subsequently added comparable
semantic case to execute against both adapters. A faster production path never
licenses removing, skipping, or weakening the deterministic reference path.

## LLVM and iOS provider

The external archive contains no NTS iOS provider, so iOS is a new, explicitly owned
workstream rather than an implied consequence of the Android code. The common LLVM
environment, callback, and typed-memory ABI remains in the compiler/common-runtime
lane. A named iOS platform owner must be assigned before Swift/Objective-C provider
files land; no current session silently acquires that ownership through this plan.
There is no iOS evidence at the planning baseline: LLVM 113 and LLVM-RC 113 were
measured on the current host and target triple, not an Apple SDK, simulator, device,
or iOS deployment target. The first iOS change establishes and records its own
compiler, artifact and execution floors rather than inheriting the host LLVM floor.

The production iOS dispatcher is built around a reviewed `URLSession` configuration
and task/delegate adapter, while the portable `ByteConnection` engine remains the
deterministic reference/fallback. The adapter must:

- disable or explicitly reconcile automatic redirects, cookies, URL cache,
  decompression, credential challenges, and retries wherever shared policy owns the
  result;
- expose HTTP/1.1, HTTP/2, and opportunistic HTTP/3 as typed negotiated capabilities
  without making public Fetch behavior depend on which protocol was selected;
- integrate Apple trust evaluation, ATS policy, hostname verification, client
  identity, system/PAC proxy selection, network-path changes, background/lifecycle
  cancellation, scheduling, and persistent storage;
- deliver delegate completions through reserved owner-environment entries rather
  than invoking compiled TypeScript on a URLSession callback queue; and
- obey the same byte-view borrow/transfer, close, liveness, backpressure, and
  observable error contracts as the native and JVM providers.

The iOS provider is validated on the minimum supported deployment target, simulator
and device, debug and optimized/release builds, Wi-Fi/cellular transitions,
foreground/background changes, certificate and hostname failures, proxy/PAC paths,
large streaming bodies, cancellation races, and late delegate callbacks.

## Source import and project configuration

The import is a refactor, not an archive extraction:

- preserve and review `LICENSE`, `NOTICE`, source provenance, WPT license/hashes,
  and useful validation records;
- remove/quarantine `realm.ts` in the same first root-visible change;
- remove the reverse URL adapter as canonical URL ownership moves shared;
- adapt names, imports, formatting, strict types, and tests to repository conventions;
- retain useful host tests but clearly label their provider; and
- do not check in nested dependency installations or generated build output; and
- treat OkHttp/Okio/Kotlin and any future native networking dependency as reviewed
  supply-chain inputs with pinned transitive versions, hashes, licenses, SBOM entries,
  and offline/reproducible-build policy—not an implicit Gradle/Maven download.

All TypeScript projects target ESNext and extend the root `tsconfig.base.json`. Add
one buildable `runtime/web-platform` aggregate to the root solution. Shared code is
checked without DOM or Node ambient globals. Host-only code uses explicit Node
imports/types. Add provider-specific NTS entry projects only when the emit tooling
needs a real compilation boundary; do not create another local base config or repeat
base settings. In a project whose sources are under `src`, do not override the
base's `${configDir}/src/**/*` include merely to spell `src` again.

Use the repository's pinned TypeScript 7.0.2 and `@types/node` 24.13.3 through the
root pnpm catalog, not the external package's TypeScript 5.8.3 / Node 25.1 setup.
The shared implementation must use its own typed interfaces for Web data, and Node
provider files may import official Node types explicitly. Do not copy Node interfaces
by hand when an exact imported type is appropriate, and do not add all Node ambient
globals to shared code merely to obtain one type.

The final TypeScript pass rejects `any`, `as never`, unchecked boundary assertions,
`Proxy`, `Reflect`, descriptor/prototype manipulation, dynamic receiver tricks, and
wrapper functions that exist only to compensate for missing compiler support.
Narrow boundary validation and checked discriminated unions replace casts. Planned
language features are used in final form and their exact compiler blocker is recorded.

## Ownership and implementation sequence

All sessions share one checkout and Git index. Commits use narrow explicit paths and
owners announce any overlap before editing it.

| Lane | Primary ownership for this integration |
|---|---|
| Node | `runtime/web-platform` shared TypeScript, canonical Web/Streams/Fetch/cache/cookie/proxy/dispatcher/HTTP/WebSocket/SSE policy, portable protocol engines, host provider, and typed native-provider/addon surface except platform-owned source; `runtime/node`; `tooling/conformance`; relevant root TypeScript solution edits; shared API/Undici/Node/WPT/Autobahn tests. N-API work is limited to Node-host addon bootstrap/testing. |
| Main/compiler | HIR/frontend; C and LLVM runtime/codegen and narrow native primitives; common environment seam; typed-memory common model; typed callback trampolines; language prerequisites; libuv/DNS/TLS/random/timer/compression/durable-storage ABI consumed by the shared compiled protocol engines; compiler gate and records. |
| JVM | JVM backend/emitter/runtime; NTS-owned Android Java from its first import; fixed networking intrinsics and stable callback interfaces; raw reference transport; reviewed OkHttp production adapter and its explicit Kotlin/Okio dependency boundary; JVM/Android tests and deterministic benchmarks. |
| iOS platform owner (to assign) | Swift/Objective-C `URLSession` and platform adapters, Apple lifecycle/trust/proxy/storage tests and release artifacts. Main owns only the common LLVM/compiler/runtime ABI unless separately authorized to own this provider. |

After explicit authorization, sequence the work as follows:

1. **Freeze/recheck baselines.** Verify the external manifest, re-run its host tests
   without changing claims, remeasure the NTS refusal groups at the actual start
   commit, and record existing floors. No design is changed to make a number prettier.
2. **Land the root-visible shared shape.** Node imports/adapts the shared TypeScript,
   removes realms before root reference, establishes `WebPlatformRuntime`, preserves
   provenance, and begins canonical URL/Blob/event/encoding reconciliation. JVM owns
   any Android Java path from the first commit rather than accepting an intermediate
   unratcheted Java dump. The iOS provider does not land until it has a named owner
   and ratchets.
3. **Build common foundations.** Main implements the environment and typed-array
   contracts and typed callback trampolines. JVM implements matching provider
   representations/loop changes in coordinated commits. Existing floors and sabotage
   tests accompany each representation change.
4. **Close language dependencies.** Main implements iteration, regexp, Promise
   executor, general class values, canonical JSON/trusted materialization, and
   remaining measured lowering arms. Node keeps the source in final form and reports
   exact diagnostics; it does not add temporary substitute APIs. This is a critical
   path, not optional parallel cleanup. This sentence is a dependency set, not an
   instruction to execute its nouns left-to-right or an override of another session's
   user-owned goal. Before implementation, reconcile that goal with the actual
   consumer graph: typed views and precise bit/integer operations block HPACK/H2;
   iteration blocks iterable bodies, Streams and the source sites that use it;
   general class/interface representation and Promise executor closures block the
   Web Streams/Fetch state machines; JSON blocks body `.json()` paths; and regexp
   blocks the exact remaining source sites that use patterns. Re-measured diagnostics
   determine which ready prerequisite is front-loaded. Protocol validation does not
   claim progress while its prerequisites refuse.
5. **Complete the shared API and policy layers.** Node extends the imported baseline
   to the full feature ledger: Web Streams and bodies, Fetch algorithms, dispatcher,
   H1/H2 contracts including HPACK/Huffman/flow control, caches, cookies, proxies,
   content codings, WebSocket extensions/`WebSocketStream`, EventSource, storage
   policies, and observability. A feature is not routed around a compiler gap; its
   exact dependency stays visible.
6. **Implement providers in parallel.** Node lands the typed native-provider surface,
   `runtime/node` integration, and separately labelled N-API addon bootstrap; Main
   lands the corresponding narrow `runtime/c` libuv/DNS/TLS/random/timer/compression/
   storage primitives and ABI; shared H1/H2/HPACK/proxy/cache algorithms remain in
   the Node-owned typed layer. JVM lands fixed intrinsics, the raw reference path,
   reviewed OkHttp adapter, compression, Android lifecycle, and callback delivery.
   The assigned iOS owner lands the `URLSession` adapter. Every provider consumes the
   same typed dispatcher/environment contract and makes policy delegation explicit.
7. **Reconcile public Node modules and globals.** Promote duplicate implementations,
   make module exports and globals identical within an environment, and remove old
   copies only after applicable tests prove the canonical replacement.
8. **Land protocols by evidence, not by shortcuts.** Bring HTTP/1.1, HTTP/2,
   compression, proxy, cache, WebSocket extension, SSE, and mobile-provider matrices
   to their required tests. HTTP/3 remains behind the stable provider seam until a
   provider implementation has its own conformance/security evidence.
9. **Conformance, sabotage, security, and performance.** Run the compiled lanes,
   expand upstream suites, fuzz protocol boundaries, exercise shutdown/races/trust,
   and only then take the batched exclusive performance measurements.

If a dependency blocks one lane, that lane records the exact blocker and continues
with independent review/tests rather than introducing an architectural workaround.

## Validation contract

### Shared deterministic tests

- In-memory/fake `ByteConnection`, deterministic randomness, and virtual time.
- Complete Headers/body/Request/Response/redirect/integrity/abort/error/event-order
  semantics for the server/mobile profile.
- ECMAScript JSON grammar, Unicode/escaping/numeric edges, ordering, omission,
  reviver/replacer/space/`toJSON`/raw-JSON behavior, cycles and syntax errors;
  differential tests cover generic erased results and direct typed materialization,
  and `Response.json()` is proved to use the same parser. Deep nesting exercises the
  explicit work stack and common resource failure, every finite number is
  cross-checked against canonical `String(number)`, non-finite values have their
  separate JSON-to-`null` cases, and lone-surrogate parse/stringify round-trips are
  tested on all providers.
- Web Streams default/BYOB/writable/transform/piping/tee/backpressure/cancel/error and
  sync/async iteration matrices, including adversarial slow and abandoning consumers.
- Incremental HTTP/1.1 and HTTP/2 parsing/serialization across every boundary,
  conflicting framing, truncation, limits, flow control, multiplexing, draining,
  pooling, cancellation, partial I/O, ALPN and h2c.
- RFC cache freshness/validation/`Vary`/invalidation/stale behavior, separate
  CacheStorage semantics, CookieJar rules, proxy/no-proxy matching and authentication,
  redirect/retry/interceptor ordering, and durable-store failure recovery.
- WebSocket handshake, masks, fragmentation, control-frame interleaving, UTF-8,
  payload/fragment limits, `permessage-deflate`, subprotocols, proxying,
  `WebSocketStream`, buffered amount, close races, and failure close.
- EventSource parsing, reconnection, retry timing, `Last-Event-ID`, cancellation and
  bounded buffering.
- Body clone/tee ownership, slow consumers, configured backlog limits, and
  materialization limits; gzip/deflate/Brotli corruption and expansion limits.
- Differential comparison to pinned Node and pinned standalone Undici for every
  applicable observable behavior, with differences classified as spec, version,
  server/mobile extension, or defect.

### Native and Node validation

- The repository's pinned Node 24.20.0 applicable suites and a separately pinned
  standalone Undici suite through the real conformance harness, including `--ts`,
  standalone compiled-native, and Node-host N-API addon paths. Results from one path
  never stand in for another.
- Real TCP/TLS/WSS peers, partial progress, IPv4/IPv6, DNS/cancel races, trust and
  hostname/client-certificate failures, H1/H2 negotiation and h2c, flow-control
  stalls, idle reuse, proxy tunnels, pool draining, shutdown, and late completions.
- Native backing alignment and all valid typed-view offset classes, plus detach,
  transfer and resize during an outstanding borrowed write; sabotage must expose a
  premature backing release rather than relying on an incidental crash.
- Tests that replace host `fetch`, `WebSocket`, `node:http`, and `node:https` with
  failing sentinels where those APIs must not be delegated.
- Dispatcher/client/pool/agent/global-dispatcher behavior, interceptors, retries,
  persistent cache stores, CookieJar, environment/CONNECT/SOCKS proxies, mocks,
  diagnostics and error taxonomy against the pinned standalone reference.
- Constructor identity between globals and Node module exports.
- Callback/storage ownership is proved in the C/LLVM reference-counting lane;
  `NoGc` separately proves logical task/source retirement and is never treated as
  evidence of deallocation merely because its retain/release counters stay zero.
- Emit/HIR verification and the main gate without emitter panics.

### JVM and Android validation

- Actual TypeScript compiled to JVM invoking the fixed intrinsic ABI; host Java tests
  alone are insufficient.
- Wrong-environment/cross-thread sabotage, completion saturation, close liveness,
  virtual-vs-monotonic time, cancellation, and retained callback/byte ownership.
- Cross-environment buffer publication stress on a physical ARM device, proving that
  writes before post are visible after owner-lane receipt and that no unsynchronized
  wrapper/backing handoff exists.
- Collector reachability coverage proving callbacks and completion storage become
  unreachable after terminal close, using weak references because this provider
  emits no reference counting.
- TLS SNI/hostname/trust sabotage, gzip CRC/trailer corruption, and unsupported
  encoding behavior.
- The OkHttp production adapter and raw reference adapter run the same semantic
  corpus; sabotage proves redirects, cookies, cache, decompression and retries do not
  occur twice or escape shared policy. HTTP/2, proxy, pooling and lifecycle behavior
  are tested against real controlled peers.
- Compressed and identity responses assert identical exposed `Content-Encoding` and
  `Content-Length` behavior on both adapters, including a sabotage that omits the
  explicit request header and proves OkHttp's transparent path is detected.
- The two-adapter applicable-case count is captured when the corpus lands and becomes
  a may-rise/not-fall ratchet; new comparable cases must execute on both paths.
- NTS-owned Java artifact reproducibility/bytecode ratchets, verified locked hashes
  and licenses for OkHttp/Okio/Kotlin dependencies, then combined release D8/R8 and
  API-26 emulator/device coverage for lifecycle, Wi-Fi/cellular transitions,
  cleartext policy, private/debug CAs, background restrictions, slow peers, and DNS
  races.

### LLVM and iOS validation

- Actual TypeScript compiled through LLVM invoking the iOS provider ABI; host Swift
  or Objective-C tests alone are insufficient.
- The URLSession production adapter and portable reference adapter run the same
  semantic corpus, with sabotage for automatic redirect/cookie/cache/decompression/
  credential behavior and late delegate delivery.
- HTTP/1.1, HTTP/2 and opportunistic HTTP/3 negotiation, TLS/ATS/client identity,
  system and explicit proxy/PAC behavior, persistent storage, cancellation,
  backpressure and close are exercised against controlled peers.
- Minimum deployment target, simulator and physical-device, foreground/background,
  Wi-Fi/cellular/network-path transition, debug and optimized/release coverage are
  required before an iOS production claim.

### Upstream and robustness validation

- Run complete applicable WPT files with the real testharness/server; do not turn
  the delivered 8/9 subset into a pass by rewriting the dictionary case.
- Classify permanent Section 13 exclusions precisely (for example arbitrary dynamic
  dictionary property enumeration) and keep planned compiler features in the active
  suite.
- Run applicable WHATWG Streams tests, standalone Undici tests, Expo behavior tests,
  HTTP/2 protocol suites, cache/cookie/proxy/content-coding corpora, Autobahn client
  coverage, and WebSocket compression tests. Record immutable upstream revisions and
  adapters; never edit a test into agreement.
- Add fuzz/incremental differential coverage for HTTP, HPACK, cache/cookie parsers,
  multipart, SSE and WebSocket/frame/extension codecs before production claims.
- Preserve visible failures and verify every sabotage test's precondition so a stale
  or skipped binary cannot make the sabotage appear green.

## Performance contract

Correctness and ownership come first, but the architecture must remain measurable.
Use deterministic pure workloads for comparable rows: HTTP parser, header
serialization, HPACK, cache/cookie/proxy parsing, gzip/Brotli, WebSocket frame and
compression codecs, SSE, UTF-8, typed-array copy/view operations, Streams
backpressure, JSON parse/stringify plus typed direct materialization, and body/clone
ownership. Treat real-server throughput as a
liveness/system measurement, not a language microbenchmark. Measure each production
provider against both its portable reference path and an idiomatic platform client
in the same context; this comparison diagnoses costs but does not license semantic
delegation.

Take final measurements once, batched under the repository's exclusive benchmark
lock with other sessions off the CPU. Report context, commit, distribution/resolution,
throughput/latency, CPU, peak and retained bytes, and open worker/socket counts. A
documentation performance claim requires a measured-here row; host-test durations
and instruction counts are not performance evidence.

## Definition of done

The integration is done only when all of the following are true:

- the shared source is canonical, strictly typed, root-solution checked, and free of
  realm/prototype/property-map/compiler-gap workarounds;
- every reachable shared integration entry produces valid HIR and the required
  native, JVM/Android, and LLVM/iOS artifacts without primary refusals belonging to
  this plan;
- the final refusal inventory is measured again over the same input, compared
  explicitly with the planning baseline of 179 primary and 52 cascading refusals,
  regrouped by underlying feature rather than diagnostic message, and every
  remaining refusal is named with its owner and reason;
- standalone native, JVM/Android, and LLVM/iOS paths execute the shared Web APIs and
  policy through their real typed providers and owning environments; the separately
  labelled Node-host N-API path loads the same compiled/native implementation rather
  than being mistaken for the standalone transport;
- typed-array aliases, callback lifetimes, completion credits, close behavior, time
  modes, byte ownership, and wrong-environment hazards have positive and sabotage
  coverage;
- Node module/global constructor identity is exact within each environment;
- the applicable pinned Node, WPT, Autobahn, repository gate, memory, differential,
  platform, and security suites are green, with genuine Section 13 exclusions still
  explicit rather than counted as passes;
- the protected numeric floors are at least LLVM 113/113, LLVM-RC 113/113, JVM
  112/112, `bench-agree` 41/41, and memory 61/61; floors may rise but may not be
  lowered to satisfy this plan;
- the non-numeric examples gate continues to require every comparable example in
  the current corpus to agree; a fixed historical count cannot substitute for that
  scaling requirement;
- Android release artifacts pass the agreed API/reproducibility/D8/R8/device gates;
- the Android production/reference adapter corpus has a recorded may-rise/not-fall
  floor, every comparable case runs on both, transparent decompression cannot alter
  exposed headers unnoticed, and the OkHttp/Okio/Kotlin transitive closure is pinned,
  hash-verified, licensed, SBOM-recorded and tested at the DEX/device level;
- iOS release artifacts pass the agreed deployment-target/simulator/device/lifecycle/
  trust/proxy/network-transition gates;
- every row in the complete server/mobile feature ledger is implemented and tested,
  or is a browser-only exclusion named above; HTTP/3 may remain an explicit stable
  extension point, but HTTP/1.1 and HTTP/2, complete Web Streams, HTTP caching,
  CacheStorage, cookies, proxies, Brotli, WebSocket compression, `WebSocketStream`,
  EventSource, JSON, persistent storage, and the dispatcher/agent surface may not be
  deferred merely because the external baseline omitted them;
- comparative performance has been measured in context and any regression is either
  fixed or explicitly reviewed with evidence; and
- conformance, security, ownership, performance, provenance, and unfinished-surface
  documentation describe what was actually executed rather than repeating the
  external host-suite counts.

The three planning sessions and the repository owner review this definition before
implementation begins. Any later architectural deviation is written down and agreed
before a lane builds on it.
