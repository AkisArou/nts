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

The ordinary-Node provider used to exercise this code on the host lives under
[`tooling/conformance/web-platform`](../../tooling/conformance/web-platform). It is
test infrastructure, not the native Node-compatible provider. The latter belongs
under `runtime/node` and calls the common runtime's typed native capabilities.
