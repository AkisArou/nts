# Integration handoff

## Ownership and compiler boundary

All delivered files live in the new `runtime/web-platform` tree. Do not overwrite
`runtime/node`, `runtime/jvm`, `runtime/c`, root tsconfig or compiler files. Agree
ownership with the active local agents before wiring exports or running NTS builds.
The ZIP was produced outside the shared machine; no changes were pushed to GitHub.

`tsconfig.json` extends `../../tsconfig.base.json`, adds ESNext-only library/types,
and covers shared source. `tsconfig.standalone.json` independently checks shared
source and the Android TS adapter without DOM or Node types. `tsconfig.node.json`
adds Node types only for the host adapter.

TypeScript type-checking is not an AOT compiler pass. In particular, probe async
functions and rejection paths, Promise resolver storage, captured callbacks,
generators/async generators, local bound-realm classes, class inheritance, Map/Set,
Uint8Array ownership/views, regex/string helpers and nullable generic fields through
HIR, native output and JVM output. These are **probe targets**, not claims that the
current compiler rejects them. No exact NTS diagnostic is recorded because NTS was
not available to execute. Record real diagnostics rather than adding host fallbacks.

For the shared package, the repository's documented probes can be adapted to:

```sh
NTS_TSGO="$PWD/target/tsgo" ./target/release/nts hir runtime/web-platform/tsconfig.json
NTS_TSGO="$PWD/target/tsgo" ./target/release/nts emit-c runtime/web-platform/tsconfig.json --out /tmp/nts-web-check --napi
```

Do not rebuild Rust or take over another agent's output directory to make these
commands work. Use the locally agreed gate and benchmark lock procedure. JVM and
native entry points/flags must be agreed with their owners; no guessed command is
presented as tested here.

## Reuse the project's URL parser

`adapters/nts/url.ts` imports the existing `runtime/node/url/src/url.ts` directly,
without importing the Node compatibility barrel. That implementation is not copied,
modified or claimed newly tested by this package.

For a Node-host test inside the NTS checkout:

```ts
import { createWebPlatform } from "./src/realm.ts";
import { createNodePrimitives } from "./adapters/node/primitives.ts";
import { NodeContentDecoder } from "./adapters/node/compression.ts";
import { ntsURLs } from "./adapters/nts/url.ts";

const host = createNodePrimitives();
const web = createWebPlatform({
  sockets: host.sockets,
  scheduler: host.scheduler,
  random: host.random,
  urls: ntsURLs,
}, { contentDecoder: new NodeContentDecoder() });
```

The standalone ZIP lacks the existing URL module; that integration-only file is not
included in standalone builds. In the longer term, move the URL implementation into
shared ownership by agreement, and let `runtime/node/url` re-export it. Do not keep
an independently diverging second URL parser. The package's standalone URLSearchParams
is for form bodies; it is not a live `.searchParams` binding on that existing URL class.

## Native / Node owner

There are two different things called Node here:

* **Node host adapter:** implemented and tested using Node's TCP/TLS primitives.
* **NTS native Node-compatible runtime:** not automatically implemented by that host
  adapter. Its libuv/FFI owner must implement `SocketConnector`, `ByteConnection`,
  `Scheduler` and `RandomSource` against the active environment and callback trampoline.

For a native binding, route completions into the existing active-environment loop;
never create a hidden host Node dependency, Worker workaround, or independent libuv
loop. Certificate verification, hostname verification, SNI, native trust-store
configuration and secure randomness remain mandatory. HTTP and WebSocket algorithms
stay in the shared package. Use the deterministic contracts and tests while native
async networking is blocked.

## Android / JVM owner

Build `NetworkPrimitives.java` into your runtime jar or Android library. Include the
Android-specific source set for `AndroidNetworking`. The supplied Gradle library
file expects the parent Android project to provide its Android Gradle Plugin version.
The default compile SDK is 36, overridable by `-PntsAndroidCompileSdk=...`; this is a
chosen build baseline, not a claim about the latest SDK. minSdk is 26. SDK/D8 builds
and device runs were not available here.

Instantiate `AndroidNetworking.create(ntsRuntimeExecutor, reporter, maxConnections)`.
The executor must queue work asynchronously on exactly one owning NTS lane. A new
executor running unrelated to the NTS loop is not sufficient glue. In an Android
application, a Handler-backed executor is appropriate only when that Handler owns
and pumps the NTS environment. The I/O workers must never invoke TS callbacks directly.

The inspected `runtime/jvm/src/nts/rt/NtsLoop.java` has static ArrayDeque queues,
virtual `now`, and timer draining that advances to future deadlines. It has no
external-I/O wakeup contract in that inspected file. Coordinate a thread-safe inbox,
wakeup, environment liveness/ref counting, real monotonic timer integration and a
microtask checkpoint after callbacks. Do not call its queue methods from workers.

ABI mappings:

| TS contract | Java method/type | Obligation |
|---|---|---|
| number socket/timer handle | positive int | Preserve integer identity; do not reuse stale handles. |
| connect timeout | int, 1..2147483647 ms | Validate; never silently overflow. |
| timer delay | nonnegative long | TS values must be finite and exactly representable. |
| Uint8Array input | byte[] + offset/length | A TS subarray's logical byteOffset must be accounted for exactly once. |
| read success | byte[], boolean eof | Transfer stable bytes into a TS Uint8Array; never reuse the array while retained. |
| write success | int count | Borrow the written byte storage until callback; Java currently completes the full slice. |
| randomFill | byte[] destination | Fill the exact destination view, copying back if the bridge needs a temporary array. |
| callbacks / BridgeTask | nested Java interfaces | Retain callbacks until one terminal callback; then release them on the owning runtime lane. |

`connect` returns a cancellable handle immediately. Every callback must occur later,
not inline before the method returns. On abort the TS adapter rejects immediately,
closes the handle, and closes late successful connections. Java cancellation cannot
interrupt every OS DNS resolver; late completions are still discarded and bounded
worker capacity is enforced. Partial primitive writes are supported by shared `writeAll`.

After ABI lowering, construct:

```ts
import { createAndroidWebPlatform } from "./adapters/android/index.ts";
import { ntsURLs } from "./adapters/nts/url.ts";
import type { AndroidNetworkBridge } from "./adapters/android/bridge.ts";

export function startNetworking(bridge: AndroidNetworkBridge) {
  return createAndroidWebPlatform(bridge, ntsURLs, {
    http1: { maxConnections: 16, maxConnectionsPerOrigin: 6 },
    bodyPolicy: { maxConsumeBytes: 32 * 1024 * 1024, maxCloneBufferBytes: 4 * 1024 * 1024 },
  });
}
```

`web.close()` shuts down its default HTTP pool and raw WebSocket sessions. The Java
owner must then call `NetworkPrimitives.close()` and finally shut down/drain its
completion executor. User-supplied Fetch/WebSocket transports are owned by the caller;
close them separately. Do not shut down the completion executor before pending
cancellation callbacks can settle.

## Required downstream gates

Run the repository's complete applicable pinned Node and WPT suites using its real
harness and HTTP fixtures; keep failures visible. The bundled WPT subset is not a
replacement. Add JVM/native tests that sabotage host API delegation, exercise real
network completions, and verify no callback enters the wrong environment.

Run Android SDK compilation and emulator/device tests for IPv4/IPv6, Wi-Fi/cellular
transitions, app lifecycle shutdown, background restrictions, platform trust policy,
private/debug CAs, bad hostnames, slow peers and DNS cancellation. Test release D8/R8
output, not only debug JVM execution. No APK or native NTS binary is included here.
