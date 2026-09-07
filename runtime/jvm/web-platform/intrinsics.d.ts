// The fixed networking intrinsics: the typed boundary between the shared
// TypeScript and the JVM providers.
//
// **All eight are wired end to end**: a `declare function` in TypeScript,
// compiled by the JVM backend to `invokestatic nts/rt/NtsWeb`, running against
// real sockets in `compiler/codegen/jvm/tests/intrinsics.rs`. Nothing here is
// gated and nothing here is aspirational.
//
// # There is no environment handle, and that is not a workaround
//
// Five of these were gated on "a common environment type" that did not exist,
// and the gate was wrong. The environment is **ambient in both runtimes**:
// `nts_environment_current` in `runtime/c` -- "the environment this lane is
// running in; never null" -- and `NtsEnv.current` on the JVM, backed by a
// `ThreadLocal` whose own comment records that a hidden parameter on every call
// was the alternative and was rejected.
//
// So the parameter was not merely unrepresentable. It was redundant, and worse
// than redundant: a parameter is something a program can get *wrong*, and an
// intrinsic handed the wrong environment would deliver its completion to a lane
// that does not own it. Reading the current one cannot have that bug.
//
// Two entries are withdrawn rather than wired; see below.
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

// There is no environment handle. See the note above.

/** A byte view: `Lnts/rt/NtsViewU8;`, carrying its own window. */
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
 *
 * WIRED.
 */
declare function nts_jvm_web_connect(
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
 * WIRED. The view carries its own window, so this reads into the view's bytes
 * and not into its buffer -- the ones outside belong to whatever else is
 * looking at that buffer. A detached buffer is a synchronous `TypeError`, as
 * the language specifies, rather than a completion: the operation never starts.
 */
declare function nts_jvm_web_read(
  handle: number,
  into: Uint8Array,
  onRead: (count: number) => void,
  onError: (code: string, message: string) => void,
): void;

/** Write from a caller-owned view, borrowed until the completion. WIRED. */
declare function nts_jvm_web_write(
  handle: number,
  from: Uint8Array,
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
// Completion reservations: WITHDRAWN, and why
// ---------------------------------------------------------------------------
//
// `nts_jvm_web_launch` and `nts_jvm_web_cancel_launch` were here: reserve a
// completion credit before submitting work, hand it back if the work was not
// submitted. They are withdrawn rather than implemented.
//
// A credit is only useful attached to the operation that will consume it, and
// every operation below now takes its own before submitting -- `connect`,
// `read` and `write` each reserve, and the socket layer reports "no credit"
// through the failure callback like any other outcome, which is what keeps
// backpressure in the same position in the task order as a connection refusal.
// A reservation threaded through TypeScript would be a handle whose only
// correct use is to give it straight back to the next call.
//
// An intrinsic that exists because a design once implied it is a worse thing to
// have than a gap: it is a name the shared layer may call, that the provider
// must keep working, and that nothing needs.

// ---------------------------------------------------------------------------
// Randomness. Filling in place, so the provider never allocates a buffer the
// caller then has to copy out of.
// ---------------------------------------------------------------------------

/**
 * WIRED. Was gated on the byte-view type, which `ManagedType::View` supplied.
 *
 * Fills the view's **window**, not its buffer: a `Uint8Array` may be a view onto
 * part of a larger `ArrayBuffer`, and the bytes outside it belong to whatever
 * else is looking at that buffer.
 */
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
