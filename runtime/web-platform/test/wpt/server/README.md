# Node WPT server for realtime APIs

This is the local resource server for the WebSocket, WebSocketStream and
EventSource WPT directories. It runs on Node's built-in HTTP, HTTPS, TCP and
zlib facilities. Every handler identifies the upstream Python resource it
reproduces. The Python files are reference sources; they are not executable
routes in this server.

`upstream-manifest.json` pins WPT revision
`a8f306ee4399724f33399dfdcac7da296f3cc05a`, and records the source path,
local path and SHA-256 of every copied file. All copies, including the test
certificates in `../tools/certs/`, retain their original bytes and notices.
`LICENSE.wpt.md` is the unedited upstream BSD-3-Clause license and covers those
copies. The root WPT license and harness belong to the shared adapter.

## Run

From the repository root, with its pinned Node and pnpm:

```sh
pnpm install --frozen-lockfile
node runtime/web-platform/test/wpt/server/cli.ts
```

The command prints the allocated origins and ports as JSON and shuts down on
SIGINT or SIGTERM. Each instance binds two HTTP and two HTTPS listeners to
`127.0.0.1`, all on port zero. WebSocket upgrades share their HTTP listener;
secure WebSocket upgrades share their HTTPS listener. Separate instances have
separate ports, stash values, message-channel queues and cancellation lifetimes.

Code that needs the server imports `startWptServer()` from `server.ts` and
awaits its idempotent `close()` during cleanup. Unexpected handler failures
remain in `server.errors`; test cleanup must assert that the list is empty.
Shutdown destroys accepted sockets, releases pending reads, cancels resource
timers and stash waiters, closes zlib contexts, and awaits active handlers.

## Package clients and TLS

`createWptRuntime(server, options?, reportError?)` in `runtime.ts` assembles
the package's existing host capabilities and installs its environment-owned
runtime. Tests import public classes from `src/index.ts`; no Node WebSocket or
EventSource is installed as a competing global. The optional error reporter
connects to the shared adapter's per-fixture reporting hook.

WPT hostnames resolve to the server's loopback socket only inside this test
connector. Logical URL, Host and TLS server name remain the WPT hostname.
The unedited WPT CA is trusted for this connector only, with normal certificate
and hostname verification. The test certificate does not cover localhost or
IP addresses, so replacing the URL's hostname with `127.0.0.1` is incorrect.

`bad-port-N.wpt:N` has a deliberate test mapping to the live HTTP listener.
The API's prohibited-port check must reject its logical port before calling
the connector. A control invokes the transport directly and confirms that
bypassing that policy really reaches the accepting peer. Otherwise a routing
failure could conceal a broken port check.

## Resources

| Module | Upstream resources |
| --- | --- |
| `websocket-handlers.ts` | Every `websockets/handlers/*_wsh.py`: echo, raw and malformed handshakes, protocols, metadata, close policies, backpressure, cookies, stash and message channels |
| `eventsource-handlers.ts` | Every `eventsource/resources/*.py`: message formatting, MIME/status variants, last-event IDs, cookie-based reconnect progression and CORS |
| `http-resources.ts` | Common redirect/trickle, WebSocket HTTP support resources, Fetch stash resources needed by stream-abort cases, and XHR chunk resources needed by split-BOM cases |
| `substitutions.ts` | The pinned `.sub.js`/`.sub.html`/PAC host and port placeholders, plus `pipe=sub` request-header substitutions |

Query bytes used by EventSource fixtures are percent-decoded as bytes. Invalid
UTF-8, NULs, BOM fragments and UTF-8 Last-Event-ID header values therefore survive
without a Unicode replacement-character round trip. Static files retain their
media types and `.headers` metadata; unknown placeholders fail explicitly.

The peer uses its own frame and handshake code so a runtime framing defect
cannot agree with an identical server defect. Deliberately malformed responses
are written verbatim. Socket reads stay paused until the handler asks for a
message, and writes wait for the socket callback, preserving the upstream
backpressure resources. Raw DEFLATE is Node's native zlib with persistent
contexts; the server declines offers that its codec or the pinned pywebsocket
negotiator cannot honor, including an 8-bit compressor window.

## Checks

The focused resource controls run directly:

```sh
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
node --expose-gc --test \
  runtime/web-platform/test/wpt-server.test.ts \
  runtime/web-platform/test/wpt-websocket-server.test.ts \
  runtime/web-platform/test/wpt-eventsource-server.test.ts
```

The existing source/host TypeScript project does not include tests. The server
and its controls are also checked under the same strict language constraints:

```sh
pnpm exec tsc --ignoreConfig --noEmit --target esnext --lib esnext \
  --module preserve --moduleResolution bundler --types node \
  --allowImportingTsExtensions --strict --noImplicitReturns \
  --noUncheckedIndexedAccess --noUnusedLocals --noUnusedParameters \
  --erasableSyntaxOnly --skipLibCheck \
  runtime/web-platform/test/wpt/server/*.ts \
  runtime/web-platform/test/wpt-server.test.ts \
  runtime/web-platform/test/wpt-websocket-server.test.ts \
  runtime/web-platform/test/wpt-eventsource-server.test.ts
```

These controls verify resource behavior and package-client integration. They
are not executions of WPT test files. The subsequent API-specific imports use
the shared `test/wpt/harness.ts` and `runner.ts`, verify the original source
before substitution, and report WPT counts per file. The three focused test
entrypoints also require registration in `tooling/conformance/web-platform/check.sh`
before landing.

## Applicability and integration boundary

This server provides HTTP/1.1 WebSocket Upgrade. HTTP/2 extended CONNECT,
browser navigation/lifecycle, real worker/window realms, CSP, mixed-content
enforcement and browser cookie policy need their respective execution
environments; serving their resource does not establish those capabilities.
The `h2` placeholder inside the unchanged constants script resolves to the TLS
port so ordinary branches parse, but API drivers must exclude the `h2`
environment rather than claim HTTP/2 coverage.

The upstream resource delays are preserved without adding elapsed-time
assertions to these controls. In particular, SSE retry tolerance tests and
stream backpressure tests contain upstream real-time/OS-buffer assumptions.
Their API drivers need an explicit deterministic execution or applicability
decision, generous deadlines, and the shared adapter's long-timeout support.
Do not edit those WPT assertions to make an overloaded machine pass.

The shared loader must support verified-then-substituted support scripts,
per-fixture location, and configurable network/reconnect deadlines before these
directories are imported. Those are changes to the shared adapter in a separate
pull request; no second testharness implementation belongs here.
