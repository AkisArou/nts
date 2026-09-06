# Security and resource contract

This networking implementation is **not independently security-audited**. Its
negative tests are evidence of specific behaviors, not proof against every parser,
lifecycle or denial-of-service defect. Review and expand upstream/fuzz testing before
production deployment with untrusted peers.

## TLS and platform trust

Node uses verified `node:tls` connections, TLS >=1.2, SNI for DNS names, normal hostname
verification and ALPN restricted to HTTP/1.1. Node's default configured CA behavior is
retained; it is not described here as universally identical to the OS trust store.
A custom PEM CA string/list is an explicit application choice. No `rejectUnauthorized:
false`, certificate-ignore option or global trust mutation is provided.

Android uses SSLSocket, platform/default SSL trust unless the application explicitly
supplies a private-CA SSLSocketFactory, HTTPS endpoint identification, SNI and TLS
1.2/1.3 when supported. The Android factory consults NetworkSecurityPolicy before
cleartext TCP. Use application Network Security Configuration for domain-specific
trust/debug policy; do not replace certificate validation with a trust-all manager.
The caller remains responsible for the trust semantics of a custom SSL factory.

The only SHA-1 implementation in the shared code is for the RFC 6455 public upgrade
accept calculation, not TLS signatures, password storage or secure randomness.
Client masks and multipart boundaries use the injected cryptographic RNG. Never wire
Math.random into that capability.

## Protocol boundaries

The HTTP parser rejects folded headers, conflicting lengths, Transfer-Encoding with
Content-Length, unsupported transfer codings, invalid chunks and truncated bodies.
Header counts/bytes and informational responses have finite limits. Request Host,
Connection and framing headers are transport-managed; an explicit mismatched
Content-Length fails rather than silently changing the wire body. Redirect responses
are canceled when abandoned; authorization/proxy authorization/cookie headers are
removed across origin boundaries.

WebSocket validates the accept value, Upgrade/Connection, selected protocol, masking
role, RSV bits, minimal lengths, control-frame constraints, continuations and UTF-8.
No extension is negotiated. Invalid payloads attempt a failure close and surface a
failed public close. There is no compression-bomb exposure through WebSocket because
permessage-deflate is absent.

## Default limits

| Limit | Default / policy |
|---|---|
| HTTP connections | 64 globally, 8 per origin |
| Pending pool acquisitions | 256 |
| Idle keep-alive | 15 seconds |
| Connect / response-head / active body-read timeout | 30 seconds each |
| HTTP header bytes / fields / interim responses | 32 KiB / 256 / 16 |
| Primitive read/write slice | up to 64 KiB |
| WebSocket frame / assembled message / queued send payload | 16 MiB each |
| WebSocket fragments per message | 65,536 |
| Outgoing WebSocket frame payload | 64 KiB |
| WebSocket close timeout | 5 seconds |
| Multipart parts / part-header bytes | 10,000 / 16 KiB |
| Body materialization / clone backlog | Infinity by default; explicitly configurable |

Connect timeout range is 1..2147483647 milliseconds for both supplied socket adapters.
A zero headers/body-read timeout disables that timeout. Body-read deadlines are armed
while a read is outstanding, not while the application is intentionally paused.

Body.clone follows the standard tee shape: a fast branch can build an arbitrarily
large slow-branch backlog. Silently stalling the fast branch at a bounded queue would
make sequential clone consumption hang. Applications needing hard bounds must set
`maxCloneBufferBytes`; exceeding it errors both branches instead. This is an explicit
safety policy deviation, not an invisible claim of standard bounded tee semantics.
Likewise set maxConsumeBytes for untrusted materialization; decompressed bytes count
against this limit. Streaming without materialization can avoid whole-body storage.

Do not leave response bodies unread: consume or cancel them, otherwise their
connections remain in use. Use abort deadlines where application latency matters.
Default pool limits are not per-user quotas and the runtime is not an HTTP sandbox.
For SSRF-sensitive applications enforce destination, scheme, resolved-address and
redirect policy at a trusted transport boundary. URL host checks alone do not prevent
DNS rebinding. Private-network and localhost access are not blocked by this library.

## Ownership and shutdown

A read transfers byte ownership to its consumer. A write borrows bytes until its
Promise/callback settles. Copy or pin Java bridge views as necessary, accounting for
byteOffset. Concurrent read+write is allowed; two reads or two writes are not.
close() must wake pending operations. FFI callbacks must not outlive their owning NTS
environment, and must never execute on the I/O workers. Default realm shutdown closes
its HTTP sockets and WebSocket sessions, including connecting operations.
