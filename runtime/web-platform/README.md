# NTS Web platform runtime

This directory owns the canonical strictly typed Web APIs and server/mobile
networking algorithms described by [`docs/web-platform-integration-plan.md`](../../docs/web-platform-integration-plan.md).

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
runtime/web-platform/src/fetch          Fetch objects, body and policy algorithms
runtime/web-platform/src/file           canonical File API objects and storage algorithms
runtime/web-platform/src/forms          FormData, URL-encoding, MIME and multipart algorithms
runtime/web-platform/src/http1          portable deterministic HTTP/1 reference engine
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

`index.ts` is deliberately narrower than the source tree: parsers, pools, codecs,
transport requests, provider primitives, policy helpers, and internal error types are
not Web globals. Providers use `provider.ts`; focused conformance tests import an
internal module explicitly when that internal algorithm is the subject of the test.

The ordinary-Node provider used to exercise this code on the host lives under
[`tooling/conformance/web-platform`](../../tooling/conformance/web-platform). It is
test infrastructure, not the native Node-compatible provider. The latter belongs
under `runtime/node/internal/web-platform` and calls the common runtime's typed native
capabilities.
