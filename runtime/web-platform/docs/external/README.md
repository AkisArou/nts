# NTS Web Platform — integration package

A statically typed, transport-independent HTTP/1.1 + Fetch + RFC 6455 implementation,
with working Node-host primitives and an Android/JVM raw-socket bridge.

**Status: tested integration baseline, not a complete browser implementation or a
claim of full Fetch/Streams/DOM/Web-IDL conformance.** NTS AOT compilation, Android
SDK builds and device execution have not been run. See [CONFORMANCE](docs/CONFORMANCE.md)
and the exact execution evidence in [VALIDATION](docs/VALIDATION.md).

## Place in the project

The ZIP contains only `runtime/web-platform/**`. Extract it into the NTS repository
root. It does not replace existing compiler, C, Node or JVM runtime files. Review
this new directory before adding it to your shared Git index.
`MANIFEST.sha256` records every delivered file except itself; after changing into
this directory, `sha256sum -c MANIFEST.sha256` verifies the unpacked contents.

```sh
cd runtime/web-platform
npm install --ignore-scripts
npm run check
npm test
npm run audit
npm run test:java
npm run test:upstream
```

`test:upstream` deliberately exits nonzero today: **8 of 9 assertions in two whole,
unchanged WPT files pass**. The remaining test requires dictionary-style Headers
initialization, outside this package's typed `Headers | readonly [string,string][]`
input profile. The runner does not hide or mark that failure as passed. It is a
small synchronous assertion bridge, not the full WPT testharness or WPT server.

The Node checks require Node >=22 and TypeScript 5.8.3. Network TLS tests use
`openssl`; Java tests use JDK 11+ with `javac --release 8` and `keytool`. This package
has **no npm runtime dependencies**. Development type declarations can themselves
reference `undici-types`; those are not an Undici runtime dependency.

## Node-host usage

```ts
import { createNodeWebPlatform } from "./adapters/node/index.ts";

const web = createNodeWebPlatform({
  http1: { maxConnections: 16, maxConnectionsPerOrigin: 6 },
  bodyPolicy: {
    maxConsumeBytes: 32 * 1024 * 1024,
    maxCloneBufferBytes: 4 * 1024 * 1024,
  },
});

try {
  const response = await web.fetch("https://example.com/", {
    headers: [["accept", "text/html"]],
    signal: web.AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (response.body !== null) {
    for await (const bytes of response.body) {
      // Process one owned Uint8Array chunk. Do not collect unless required.
      console.log(bytes.length);
    }
  }
} finally {
  web.close();
}
```

Use the realm's constructors together: `web.Request`, `web.Response`, `web.Headers`,
`web.ReadableStream`, `web.Blob`, `web.File`, `web.FormData`, `web.URLSearchParams`,
`web.AbortController`, `web.AbortSignal`, `web.WebSocket`, `web.TextEncoder` and
`web.TextDecoder`. Native host BodyInit classes are not transparently substituted.
`json()` returns `unknown`; `jsonAs(yourDecoder)` performs caller-supplied validation.

```ts
const socket = new web.WebSocket("wss://your-server.example/socket", ["chat"]);
socket.binaryType = "arraybuffer";
socket.onopen = () => socket.send("hello");
socket.onmessage = event => console.log(event.data);
socket.onclose = event => console.log(event.code, event.wasClean);
// Later: socket.close(1000, "done"); then web.close() at realm shutdown.
```

The Node adapter uses `node:net`, `node:tls`, `node:crypto`, `node:timers`, and native
zlib transforms. It does **not** use `node:http`, `node:https`, host fetch, host
WebSocket or an HTTP/WebSocket package. `node:url` is the standalone-host URL binding;
inside NTS, use the existing pure TypeScript URL parser through `adapters/nts/url.ts`.
See [INTEGRATION](docs/INTEGRATION.md) for the actual binding snippet.

## Architecture

```text
Realm / public typed APIs
 ├── Headers, Request, Response, body ownership, clone/consume
 ├── EventTarget / abort / UTF-8 / Blob / File / FormData
 ├── default-reader ReadableStream subset
 ├── FetchClient ─────────────── FetchTransport (injectable)
 │                               └── shared Http1Transport + ConnectionPool
 └── public WebSocket ───────── WebSocketTransport / WebSocketSession (injectable)
                                 └── shared upgrade + RFC 6455 frame/message codec
                                            │
                        ByteConnection / SocketConnector / Scheduler / RandomSource
                           ├── Node: TCP + TLS + crypto + timers
                           └── Android TS bridge → Java Socket / SSLSocket / SecureRandom
```

Redirects, header policy, request replay, body state, abort propagation, HTTP framing,
WebSocket handshake validation, masking, fragmentation, ping/pong, close state and
message-event scheduling live in TypeScript. An alternate message-level WebSocket
adapter can bypass the raw codec without rewriting the public state machine. Its
session must satisfy the same contract; any platform framing ownership must be an
explicit, reviewed choice, not hidden host WebSocket delegation.

Transport reads and writes are bounded, support partial progress, and transfer or
borrow byte ownership explicitly. HTTP uses keep-alive pooling, not one socket per
request. There is no pipelining, HTTP/2, HTTP/3, automatic retry, proxy support or
implicit whole-body download. `.text()`, `.json()`, `.bytes()`, `.blob()` and
`.formData()` intentionally materialize their results.

## Android / JVM

`adapters/android/**` is the TypeScript adapter. `android/src/main/java/**` is actual
Java I/O and TLS code, not Java networking pseudocode. `android/src/android/java/**`
adds the Android NetworkSecurityPolicy factory. The intended Android minimum is
API 26. Java unit/integration tests run without an Android SDK.

The JVM backend must lower the interface in `adapters/android/bridge.ts` to the
matching Java methods, map `Uint8Array` views to byte arrays correctly, and dispatch
callbacks on the **owning NTS runtime lane**. This compiler glue is intentionally not
invented as an untested ABI. The current inspected `NtsLoop` uses thread-confined
queues and virtual-time timers; it cannot simply receive callbacks from Java I/O
threads. Full integration steps are in [INTEGRATION](docs/INTEGRATION.md).

TLS uses platform facilities, verified certificates and HTTPS endpoint identification.
No extra TLS dependency is required for these two adapters. Android cleartext policy
is checked explicitly before opening raw sockets. Android currently requests identity
content encoding; unsolicited compressed responses fail unless a `ContentDecoder`
is supplied. No Android streaming decompressor has been implemented here.

## Read before shipping

[CONFORMANCE](docs/CONFORMANCE.md) lists API coverage and differences.
[SECURITY](docs/SECURITY.md) describes limits, trust, cancellation, and ownership.
[PERFORMANCE](docs/PERFORMANCE.md) explains memory and concurrency tradeoffs.
[SOURCES](docs/SOURCES.md) records the inspected repository and upstream sources.

This is suitable for local-agent integration and further conformance work. It has
not undergone an independent security audit or comparative performance benchmarking.
