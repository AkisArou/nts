# API profile and conformance ledger

This is a **typed non-browser networking profile**. Its core is not a JavaScript
engine or Web-IDL wrapper. Semantic algorithms have substantial tests, but full
standards conformance is not claimed.

## Implemented

| Area | Implementation |
|---|---|
| Headers | Name/value validation, HTTP whitespace normalization, raw ordered duplicates, sorted/live public iteration, append/set/delete/get/has, Set-Cookie list, immutable response guards. |
| Bodies | Pull streams; lock/disturbed tracking; text/bytes/ArrayBuffer/JSON/Blob/FormData consumption; transfer; clone tee; replayable immutable sources; cancellation. |
| Request / Response | Typed construction, methods, HTTP(S) URL validation, body constraints, cloning, errors/redirect/JSON factories, status/statusText, response URL and redirected flag. |
| Fetch | Redirect modes and 20-hop ceiling; POST/303 rewriting; replay rules; cross-origin credential-header stripping; abort before/during/after headers; error conversion; injected decompression. |
| HTTP/1.1 | TCP/TLS operation, incremental heads and bodies, informational responses, fixed/chunked/EOF framing, trailers validation, partial I/O, persistent connection pool and deadlines. |
| WebSocket | Shared upgrade validation, client masks, incremental frames, continuation messages, control frames, UTF-8 validation, size/fragment limits, subprotocol validation, close handshake/timeouts, public states/events and bufferedAmount. |
| Supporting APIs | Non-tree EventTarget, Event/MessageEvent/CloseEvent, AbortController/Signal, UTF-8 TextEncoder/TextDecoder, in-memory immutable Blob/File, FormData, standalone URLSearchParams. |
| Forms | URL-encoded forms; streaming multipart encoding from Blob segments; materializing multipart decoding with boundary/part-header limits, files and duplicate fields. |

## Deliberate profile differences and unfinished work

**Web-IDL and API shape.** Headers takes another shared Headers or a readonly list
of name/value tuples, not arbitrary JavaScript dictionaries/iterables. Arbitrary
property getters, prototype behavior, argument coercions, cross-realm brand checks,
receiver brand semantics, descriptors and dynamic Symbol protocols are not reproduced.
The APIs are ordinary typed classes, not IDL-generated exotic objects. Callback
`thisArg` overloads are not present on collection `forEach`. Host Blob/Request/Response/
ReadableStream/AbortSignal objects are not accepted as shared equivalents. Global
installation, DOM trees, Window, Document, worker creation and timer globals are not
part of this package; scheduling is explicitly injected.

**Browser Fetch policy.** No CORS enforcement/preflight, opaque or opaqueredirect
filtering, CSP, mixed-content policy, service workers, HTTP cache, integrity checking,
referrer policy, cookie jar, automatic HTTP authentication or browser navigation.
`credentials` is validated/stored but does not create a cookie or credential store.
Explicit Cookie headers are permitted in this server-style profile. Browser request
and request-no-cors header guards are not implemented. Only HTTP(S) schemes are
supported. Request mode/cache/referrer/integrity/keepalive options are not exposed.
Manual redirects expose the actual response rather than browser opaque filtering.

**Headers detail.** The generic Fetch header-list get algorithm uses comma+space
for duplicates, including Cookie. Node's native Headers has a Cookie semicolon-join
special case; the core follows the generic Fetch algorithm. Wire entries retain
separate occurrences. Set-Cookie iteration and getSetCookie preserve distinct fields.
The strict HTTP transport rejects control characters that the public Headers class
can represent; it does not liberalize wire syntax to make malformed HTTP acceptable.

**Streams.** ReadableStream is the default-reader subset used by bodies. No BYOB
byte-controller mode, WritableStream, TransformStream, pipeTo/pipeThrough, structured
clone transfer or full Streams conformance. `tee` defaults to reference-sharing for
generic chunks; Body.clone explicitly copies byte chunks. Source authors must honor
desiredSize; an arbitrary producer can enqueue beyond its high-water mark, just as a
high-water mark is not a universal memory limit.

**Events / abort.** EventTarget is non-tree, with function listeners, once/capture
identity, registration-ordered property handlers and exception reporting. No passive
listeners, signal listener options, handleEvent objects, DOM propagation tree or
trusted browser-generated event objects. MessageEvent/CloseEvent constructors use
explicit typed payloads, not complete Web-IDL initialization dictionaries. Synthetic
wrong-payload message events do not satisfy the WebSocket property-handler type guard.
AbortSignal.any currently uses strong subscriptions until a parent aborts; long-lived,
never-aborted parents with repeated dependent signals need a weak-dependency/lifecycle
solution in the runtime. Avoid one never-aborted application-wide parent for an
unbounded number of completed operations. Full GC behavior is not implemented.

**Encoding / files.** UTF-8 only; no legacy encodings or encoding streams. Blob/File
are memory-backed; File does not read filesystem paths. URLSearchParams is standalone,
not the live view of the project's existing URL class. Form parsing is strict: UTF-8
fields, no legacy character-set negotiation, no MIME Content-Transfer-Encoding beyond
binary/8bit, and no filename* extension decoding. Multipart parsing is materializing
and has not passed the full multipart upstream corpus. No disk-spooling Blob backend.

**Network.** HTTP/1.1 only. No HTTP/2/3, proxies, CONNECT tunneling, retries, pipelining,
Alt-Svc, permessage-deflate or transparent reconnect. WebSocket extensions are not
offered; an unsolicited extension is rejected. Only the client role has a public
WebSocket transport. The codec's role/mask parameter supports deterministic server-side
codec tests, not a complete public server implementation. A clean close is reported
once both close frames have been exchanged; the implementation then closes the socket.

**Compression.** Node supplies gzip, zlib-wrapped deflate and Brotli primitives.
Legacy raw-deflate sniffing is not implemented. Android has no bundled ContentDecoder;
identity is requested and unsupported returned codings cause a visible error.

## Actual upstream result

Two complete WPT files are included byte-for-byte. Their Git blob hashes and license
are in `third_party/wpt/manifest.json`. The minimal runner supports exactly their
synchronous test/assertion APIs and verifies hashes before execution.

* `headers-combine.any.js`: 6/6 pass.
* `headers-normalize.any.js`: append and set normalization tests pass; dictionary
  constructor test fails with `TypeError: entries is not iterable` (2/3 pass).

The upstream normalization test revealed an implementation defect which was fixed:
outer HTTP CR/LF whitespace is removed before embedded-newline validation. No upstream
assertion was edited to accept the old behavior. The dictionary failure remains visible.

No full WPT run, Node v24.20.0 run, browser interoperability certification, NTS compiler
run, Android SDK run or device run is claimed. Local deterministic, differential and
network tests are complementary evidence, not replacements for these downstream gates.
