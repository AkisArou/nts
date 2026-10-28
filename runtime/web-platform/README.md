# NTS Web platform runtime

This directory owns the canonical strictly typed Web APIs and server/mobile
networking algorithms described by [`docs/records/notebooks/web-platform-integration-plan.md`](../../docs/records/notebooks/web-platform-integration-plan.md).

The current source began from the separately delivered web-platform implementation,
but that delivery is an implementation baseline rather than the feature boundary.
Its synthetic `realm.ts` hierarchy was deliberately not imported. The replacement is
top-level canonical classes plus an environment-owned `WebPlatformRuntime`; provider
bootstrap, not compiled TypeScript mutation of `globalThis`, exposes globals.

Historical delivery documents and test evidence are retained under
[`docs/external`](docs/external). They describe the external baseline and must not be
read as evidence that the integrated native, JVM/Android, or LLVM/iOS paths execute.
Current integration evidence belongs in [`docs/BASELINE.md`](docs/BASELINE.md) and
subsequent validation records.

Shared source compiles without DOM or Node ambient globals and extends the repository
root `tsconfig.base.json`. Platform providers import only explicit typed capabilities;
observable Fetch, Streams, HTTP, cache, cookie, proxy, WebSocket, SSE, and body policy
stays in this shared layer.

## Repository layout

```text
runtime/web-platform/src/index.ts       canonical public Web values and public types
runtime/web-platform/src/provider.ts    stable provider-facing entry point
runtime/web-platform/src/core           shared Web foundations
runtime/web-platform/src/cookies        cookie helpers, storage and Fetch policy
runtime/web-platform/src/fetch          Fetch objects, body and policy algorithms
runtime/web-platform/src/file           canonical File API objects and storage algorithms
runtime/web-platform/src/forms          FormData, URL-encoding, MIME and multipart algorithms
runtime/web-platform/src/http1          portable deterministic HTTP/1 reference engine
runtime/web-platform/src/http2          portable HTTP/2 framing and HPACK engine
runtime/web-platform/src/provider       native capability contracts and runtime assembly
runtime/web-platform/src/streams        canonical Web Streams implementation
runtime/web-platform/src/websocket      WebSocket API, protocol and reference engine

runtime/node/internal/web-platform      native Node-compatible provider (when introduced)
tooling/conformance/web-platform        ordinary-Node host provider and host tests
runtime/jvm                              JVM/Android provider, owned by the JVM lane
```

There is intentionally no `runtime/web-platform/adapters` directory. A platform
implementation is not shared runtime code merely because it adapts a shared
interface. The ordinary-Node implementation imports Node built-ins and therefore
belongs to conformance tooling; the native provider is part of the Node runtime;
mobile implementations live with their owning runtime. Only capability contracts
and provider-independent observable algorithms belong here.

Content decoding is likewise split at that boundary: a provider supplies streaming
gzip, deflate, and Brotli codec primitives, while shared Fetch code owns coding
order, cancellation, and resource policy. `contentCodingPolicy` defaults to a
256 MiB decoded-body ceiling and a 100:1 final-decoded/wire-byte ratio after a
1 MiB grace allowance. These are configurable server/mobile safety limits, not
Fetch-standard limits; an embedder may raise either limit or set it to `Infinity`
explicitly. A coding must not be advertised unless the provider's decoder validates
its format, checksum, and trailer as applicable.

`src/provider/compression.ts` defines the synchronous native streaming capability
for `gzip`, `deflate`, and `deflate-raw`. Its contexts consume a whole input chunk
per call and support normal processing, synchronous flush, finish, reset, and
bounded output. Framing, DEFLATE, CRC-32, Adler-32, and gzip header/trailer
validation belong to the provider. It returns failures as values and reports
unconsumed trailing input so shared code can deliver valid output before the
specified error. The same raw-DEFLATE mode supports RFC 7692 without moving
WebSocket negotiation, tail handling, or context-takeover policy into native code.

The canonical `CompressionStream` and `DecompressionStream` classes in
`src/compression/compression-stream.ts` implement the
[Compression Standard §§2–5](https://compression.spec.whatwg.org/) using the shared
`TransformStream`. Public construction obtains the capability from the installed
environment-owned `WebPlatformRuntime`, supplied through `WebPlatformOptions.compression`.
The runtime captures it once without opening a native context; each stream owns
the context created by its constructor. Existing streams retain that context
when the active runtime changes. Missing capability produces a `TypeError`.
The public barrel exports the canonical classes, and the provider barrel exports
the capability types. Provider bootstrap owns global exposure. Internal embedding
factories remain outside both barrels. Brotli is outside this implementation's
three-format scope.

The compression test provider lives only in `test/node-compression-provider.ts`
and calls `node:zlib`'s synchronous native streaming handle on the pinned Node 24
host. Native strict end handling prevents concatenated gzip members and ignored
trailing bytes. No compression primitive or checksum is implemented in shared
TypeScript. Focused tests cover both the stream algorithms and the reusable
capability and public runtime integration; the unedited WPT `compression/` import
awaits the canonical shared versions table on main. Descriptor-only and
patched-intrinsic-accessor cases are left out under the cloud-agent rules.
Migrating WebSocket's existing provider is a separate change after the realtime
stack lands.

`WebSocket` and `WebSocketStream` share one URL, protocol-offer, close-code,
and close-reason conversion layer and the same provider `WebSocketSession`.
`WebSocketStream` is implemented directly on that session rather than by
wrapping `WebSocket` events: its readable side issues at most one transport
read to fill its one-chunk queue, and its writable promises settle only when
the provider has accepted the corresponding message bytes. Closing a writer
waits for the peer's close frame. Public construction obtains the transport
and lifetime registry from the environment-owned `WebPlatformRuntime`, which
also terminates streams when the environment closes. The API surface follows
Chromium's current experimental IDL and the WPT `websockets/stream/tentative`
corpus; RFC 6455 remains the wire-protocol authority.

The raw transport offers RFC 7692 `permessage-deflate` only when a provider supplies
bounded raw-DEFLATE contexts. Negotiation, RSV1 validation, fragmentation, the flush
tail transformation, context-takeover reset rules, decompressed-size enforcement,
and close-code selection remain shared TypeScript. The ordinary-Node conformance
provider supplies only the zlib primitive. Both its incremental output cap and the
shared postcondition enforce the configured message limit, so a provider cannot
silently turn a compressed message into unbounded retained output.

`index.ts` is deliberately narrower than the source tree: parsers, pools, codecs,
transport requests, provider primitives, policy helpers, and internal error types are
not Web globals. Providers use `provider.ts`; focused conformance tests import an
internal module explicitly when that internal algorithm is the subject of the test.

The ordinary-Node provider used to exercise this code on the host lives under
[`tooling/conformance/web-platform`](../../tooling/conformance/web-platform). It is
test infrastructure, not the native Node-compatible provider. The latter belongs
under `runtime/node/internal/web-platform` and calls the common runtime's typed native
capabilities.

The HPACK codec implements RFC 7541's complete static and dynamic tables, integer
and string representations, Huffman alphabet, table-size synchronization, sensitive
never-indexed fields, and independent encoded-string/header-list resource limits.
Its focused suite includes every RFC request/response vector. The wider
interoperability runner consumes the upstream `http2jp/hpack-test-case` repository
pinned at `8a1406e7d14bfcb6c046021f13cc15cfb162726d`; pass that clean checkout to
`tooling/conformance/web-platform/test-hpack-upstream.mjs`. It is intentionally not
downloaded by the ordinary offline conformance gate.
