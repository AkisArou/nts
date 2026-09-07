// The fixed networking intrinsics: the typed boundary between the shared
// TypeScript and the JVM providers.
//
// Every declaration below has a Java method behind it today, with tests. Four
// of the nine are **wired end to end** -- a `declare function` in TypeScript,
// compiled by the JVM backend to `invokestatic nts/rt/NtsSocket`, running
// against real sockets in `compiler/codegen/jvm/tests/intrinsics.rs`. They are
// the four whose whole signature is `number` and `void`.
//
// The other five take an environment handle or a byte view. There is no common
// environment type and `ManagedType::View` does not exist, so those cannot be
// written in TypeScript at all yet; they are marked GATED where they are
// declared. The split is four/five rather than nine/zero because the four that
// could be wired were, rather than waiting for the two missing types to arrive
// together -- and wiring them is what found `ops::web_external` missing, which
// no Java test could have.
//
// There is no general Java binding facility and this is deliberately not one.
// The plan's boundary is "a small typed runtime-owned intrinsic table whose
// TypeScript declarations state the real ABI", and small is the point: every
// entry here exists because a shared protocol engine needs it, not because Java
// has it.
//
// # Why the shapes are what they are
//
// **Two callbacks, never one.** A generated closure lowers to a class with
// exactly one method named `call`, so a Java interface with two methods -- an
// `onSuccess` and an `onError` -- can never be implemented by TypeScript. Every
// completion below is therefore a pair of closures rather than one object. That
// is not a style choice; the alternative does not compile.
//
// **Every completion is asynchronous, including the ones already known.** No
// credit, a full queue, a closed handle: all are decided before the call
// returns and all are still delivered as tasks. Reporting them inline would put
// them at a different position in the task order than a connection refusal, so
// a program's output would depend on *which* failure happened rather than on
// the fact that one did.
//
// **Errors are a code and a message, both strings.** Not an error object: that
// is a representation decision belonging to the common types, and a
// provider-local error class is exactly the JVM-only semantics this boundary
// exists to avoid.

/** An environment handle. GATED: there is no common environment type yet. */
type JvmEnv = unknown;

/** A byte view. GATED: `ManagedType::View` does not exist yet; see below. */
type JvmBytes = Uint8Array;

// ---------------------------------------------------------------------------
// Sockets. Behind `nts.rt.NtsSocket` on the JVM and
// `org.nts.web.NetworkPrimitives` on Android; the two are held together by a
// test that runs every case through both and requires the same answer.
// ---------------------------------------------------------------------------

/** No proxy. */
declare const NTS_JVM_DIRECT: 0;
/** An HTTP proxy, reached with `CONNECT` and tunnelled through. */
declare const NTS_JVM_HTTP_PROXY: 1;
/** A SOCKS proxy, which the platform speaks below TLS. */
declare const NTS_JVM_SOCKS_PROXY: 2;

/**
 * Connect, optionally through a proxy. Returns a cancellation handle
 * immediately; every callback happens later.
 *
 * TLS through a `CONNECT` tunnel verifies the certificate against the
 * **target**, never the proxy. `proxyHost` is `null` for a direct connection.
 */
declare function nts_jvm_web_connect(
  env: JvmEnv,
  host: string,
  port: number,
  secure: boolean,
  timeoutMs: number,
  proxyHost: string | null,
  proxyPort: number,
  proxyKind: number,
  onOpen: (handle: number) => void,
  onError: (code: string, message: string) => void,
): number;

/** Idempotent, safe from any lane, and a late success still closes its socket. WIRED. */
declare function nts_jvm_web_cancel_connect(request: number): void;

/**
 * Read into a caller-owned view. `onRead` reports the count, or `-1` at end of
 * stream.
 *
 * GATED on the byte-view type: the JVM side takes `(byte[], offset, length)`
 * and a `Uint8Array` cannot yet be lowered to those three. Until then the
 * transport is reachable from Java and not from TypeScript.
 */
declare function nts_jvm_web_read(
  env: JvmEnv,
  handle: number,
  into: JvmBytes,
  onRead: (count: number) => void,
  onError: (code: string, message: string) => void,
): void;

/** Write from a caller-owned view, borrowed until the completion. GATED as above. */
declare function nts_jvm_web_write(
  env: JvmEnv,
  handle: number,
  from: JvmBytes,
  onWrote: (count: number) => void,
  onError: (code: string, message: string) => void,
): void;

/** Idempotent, and what makes a blocked read or write return. WIRED. */
declare function nts_jvm_web_close(handle: number): void;

/**
 * The default network changed; every connection on the old one is gone.
 * Returns how many were closed.
 *
 * Not a no-op that waits for the reads to fail: a socket on a replaced network
 * reports nothing for as long as the kernel will give it, so the failure a
 * program eventually sees is a timeout arriving long after the cause. Every
 * in-flight completion still arrives -- closing under a blocked worker is what
 * unblocks it -- so nothing the caller reserved is stranded.
 *
 * WIRED.
 */
declare function nts_jvm_web_network_changed(): number;

/** Live connections, for tests and for backpressure reporting. WIRED. */
declare function nts_jvm_web_open_count(): number;

// ---------------------------------------------------------------------------
// Completion reservations. A credit is taken *before* the I/O is submitted, so
// backpressure is refusal rather than an unbounded queue.
// ---------------------------------------------------------------------------

/** Reserve a completion credit, or report that none is available. */
declare function nts_jvm_web_launch(env: JvmEnv): boolean;

/** Give a reserved credit back without having used it. */
declare function nts_jvm_web_cancel_launch(env: JvmEnv): void;

// ---------------------------------------------------------------------------
// Randomness. Filling in place, so the provider never allocates a buffer the
// caller then has to copy out of.
// ---------------------------------------------------------------------------

/** GATED on the byte-view type, for the same reason as read and write. */
declare function nts_jvm_web_random_fill(into: JvmBytes): void;

// ---------------------------------------------------------------------------
// What is NOT here, and why
// ---------------------------------------------------------------------------
//
// **Timers.** `nts_set_timeout` and `nts_clear_timeout` already exist in
// `hir::runtime` and are not web-platform intrinsics. A second timer entry
// point would be a second answer to a question the middle end has settled.
//
// **HTTP.** No `fetch`, no headers, no redirects. The shared TypeScript owns
// every observable Fetch behaviour, and the production OkHttp provider is
// configured to do none of it -- the whole reason that provider is mostly a
// list of things turned off. An intrinsic that returned a parsed response
// would move policy into the provider, where it would differ per platform.
//
// **Compression.** `NtsGzip` decodes gzip on the JVM, and the OkHttp provider
// explicitly sets `Accept-Encoding` so OkHttp does not decompress and strip the
// headers describing what it decompressed. Which side inflates is the shared
// code's decision, and an intrinsic here would take it away.
