> nodejs uses undici for fetch and websockets. as far as I understand, we are not going to use undici, right? it is written in untyped javascript. what should we do? build
> our own?

• Correct: the compiled NTS runtime should not depend on Undici. It is JavaScript-heavy, dynamically shaped, and assumes V8’s object model, so compiling or wrapping it would undermine NTS’s
static architecture.

We should build our own compatible implementation, but not put everything in C:

- TypeScript: Fetch algorithms, redirects, headers, request/response bodies, cookies policy, WebSocket framing/state machine, validation, and pooling policy.
- Native C: sockets, DNS, TLS, secure randomness, timers, and compression.
- Reuse existing typed URL, Buffer, streams, AbortSignal, node:http, and zlib implementations.
- Add TLS/HTTPS as a proper native-backed layer; Fetch and secure WebSockets depend on it.
- Use Node’s pinned tests, Web Platform Tests, the Fetch standard, and Undici behavior as compatibility oracles.

For Fetch, I would create a shared typed web-platform layer containing Headers, Request, Response, FormData, body handling, and the fetch dispatcher. The first transport can use our
HTTP/1.1 Agent; HTTP/2 and HTTP/3 can follow later without changing the public API.

WebSocket is smaller: HTTP Upgrade plus a typed frame parser, masking, fragmentation, ping/pong, close handling, and optional per-message deflate through zlib.

The Node-host bindings.node.mjs/shape layer may use Node’s existing global fetch or WebSocket for testing façade behavior. That must not be mistaken for the compiled implementation.

So: architecturally our own implementation, yes—but protocols in clean typed TypeScript compiled to native code, with only genuine operating-system and cryptographic boundaries in C.
Porting useful algorithms from Undici is reasonable under its license, but a wholesale Undici port is not.

› As you mind have seen, I am also building a jvm backend, to compile TS -> jvm bytecode, so we can later build android apps. How could we reuse code? (Ofcourse do not stretch anything to
fit this need) Should we? Give me an example of what could we reuse and what each platform should build its own

• Yes, there is meaningful reuse—but it should happen at the semantic layer, not by forcing both platforms onto the same networking machinery.

A good split is:

Shared typed TypeScript
Fetch/WebSocket semantics
│
typed transport contract
┌────┴────┐
Native/C JVM/Android

For example, fetch() could work like this:

// Shared contract, intentionally smaller than node:http.
interface FetchTransport {
dispatch(request: TransportRequest): Promise<TransportResponse>;
}

The shared TypeScript implementation would own:

- Headers, Request, Response, and body state.
- URL and method normalization.
- Header validation.
- Redirect handling.
- Abort behavior.
- Body consumption, bodyUsed, cloning and decoding.
- FormData and multipart serialization.
- Authentication-header removal across origins.
- Fetch-specific error conversion.

Then each platform supplies dispatch():

- Native backend: our typed node:http/future node:https, backed by libuv and TLS C bindings.
- JVM backend: an adapter around the appropriate Java/Android HTTP stack.
- Tests can supply an in-memory transport.

A request would therefore flow as:

fetch(input, init)
→ shared normalization and policy
→ FetchTransport.dispatch()
→ platform networking
→ shared Response/body behavior

The platform adapter should disable automatic behavior such as redirects, cookie management, and possibly decompression when possible, because those policies belong in the shared layer. If
a platform client cannot expose sufficiently raw behavior, that is a reason to move that particular responsibility into the adapter—not to distort the common interface.

WebSocket can use a similar design:

interface WebSocketTransport {
open(
request: WebSocketHandshake,
observer: WebSocketTransportObserver,
): Promise<WebSocketConnection>;
}

Reusable TypeScript pieces include:

- URL and subprotocol validation.
- Public connection state.
- Event ordering.
- Close-code and close-reason validation.
- Handshake header construction and validation.
- Message and binary-data normalization.

On native platforms, we could additionally reuse a typed WebSocket frame codec: masking, fragmentation, ping/pong, close frames, and size validation. On the JVM, a platform WebSocket
client may already own framing and TLS. We should use it if its observable behavior can be adapted correctly; duplicating framing there merely for symmetry would be unnecessary.

What should generally be shared:

- URL parsing and serialization.
- HTTP header rules.
- Fetch request/response/body algorithms.
- Redirect and abort policy.
- WebSocket validation and public state machine.
- WebSocket framing where the transport exposes raw bytes.
- Text encoding, MIME parsing, FormData and multipart logic.
- Typed errors and platform-independent test cases.

What should remain platform-specific:

Capability Native/C backend JVM/Android backend
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TCP and DNS libuv/native bindings Java/Android networking
──────────────────────────────── ──────────────────────────────────── ─────────────────────────────────────
TLS OpenSSL or chosen native TLS layer JVM/Android TLS and trust store
──────────────────────────────── ──────────────────────────────────── ─────────────────────────────────────
Event-loop integration NTS/libuv host JVM executor/event-loop integration
──────────────────────────────── ──────────────────────────────────── ─────────────────────────────────────
Certificate validation native trust configuration Android/JVM trust configuration
──────────────────────────────── ──────────────────────────────────── ─────────────────────────────────────
Proxy discovery environment/Node rules Android/JVM proxy configuration
──────────────────────────────── ──────────────────────────────────── ─────────────────────────────────────
Compression engine native zlib JVM inflater/deflater
──────────────────────────────── ──────────────────────────────────── ─────────────────────────────────────
Secure randomness OS/native API SecureRandom or platform equivalent
──────────────────────────────── ──────────────────────────────────── ─────────────────────────────────────
HTTP connection pooling native Agent/transport JVM HTTP client
──────────────────────────────── ──────────────────────────────────── ─────────────────────────────────────
Android lifecycle/connectivity not applicable Android-specific adapter

One important boundary: node:http itself should not become the common abstraction. Agent, writable globalAgent, raw socket events, Node environment proxies, and CommonJS behavior are Node
compatibility features. Android Fetch should not need to imitate them.

I would introduce a neutral shared package—conceptually something like runtime/web—only when both consumers actually need it. The native node:http implementation can then be one transport
provider, while the JVM uses its natural platform transport. That gives us substantial semantic reuse without forcing Android to impersonate Node or forcing native builds to imitate the
JVM.
