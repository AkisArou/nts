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

/**
 * The proxy result string for a URL, in the classic auto-configuration grammar.
 *
 * `PROXY host:port`, `SOCKS5 host:port`, `SOCKS host:port` or `DIRECT`, joined
 * with `"; "`. Formatting only -- the grammar is parsed above this seam, where
 * it has its own tests, and a second parser here would be a second answer.
 *
 * Measured on API 26 rather than assumed, because three properties of the
 * platform decide the shape:
 *
 * - It is **synchronous with no I/O**: 46-87 microseconds on the first call of
 *   a cold process and 2-11 after. No network, no file, no PAC fetch.
 * - It is **per-URL on both axes**, scheme and host, so the argument is not
 *   decoration.
 * - It **never answers empty and never throws**: with nothing configured every
 *   URL gets exactly one `DIRECT`, so `null` is unreachable here and the shared
 *   side's nullable return stays for platforms that have no proxy story.
 *
 * The SOCKS version is *established* and not assumed: `Proxy.Type.SOCKS` covers
 * both versions and the selector will not say which, so the version comes from
 * `socksProxyVersion`. Answering `SOCKS5` for a SOCKS4 proxy would type-check,
 * look like support, and fail inside a handshake the peer never agreed to
 * speak. WIRED.
 */
declare function nts_jvm_web_system_proxy_for(url: string): string;

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

// ---------------------------------------------------------------------------
// The durable byte store
//
// The provider half of `runtime/web-platform/src/storage/durable.ts`: bytes,
// atomicity, durability and enumeration, and nothing above them. RFC 9111
// freshness, `Vary`, invalidation, eviction, quota policy and CacheStorage
// matching are shared TypeScript, and none of these is a primitive for any of
// them.
//
// # Views both ways, and why that is the table's decision rather than a taste
//
// Three entries above take a caller's window -- `random_fill` fills one,
// `read` and `write` borrow one for the duration of an operation. A byte store
// that allocated at this seam would be the only entry that does, and every
// value would be copied twice: once out of the file, once into the view the
// caller wanted anyway. So `append` takes a view and the two reads fill one.
//
// `append` takes no offset or length beside the view because a view carries
// both. Passing them again is a second answer to one question, and the two can
// disagree.
//
// # The two short-buffer rules are the same rule
//
// `read` and `list` both answer **what there was** and write **what fits**, so
// a caller that guessed too small learns the right size from the same call. Two
// fill-buffer calls with different short-buffer semantics would be a trap
// discovered once, painfully.
//
// # `-1` at the end of a range, never `0`
//
// An empty chunk and the end of a stream are different answers. Making zero
// unreachable is what stops every consumer having to know that.

/** Points the store at a directory, and sweeps whatever a crashed run left. WIRED. */
declare function nts_jvm_store_configure(root: string): void;

/** Abandons every write and ranged view. Committed values stay; they are on disk. WIRED. */
declare function nts_jvm_store_close(): void;

/**
 * Begins replacing a key, and answers the handle the next three take.
 *
 * Refuses when the key already has a live write. The store is sequential per
 * key, and making that true by *waiting* would turn a caller's mistake into a
 * pause, with the pause as the only evidence it made one. A caller that wants
 * the later value serializes above this seam, where it can also decide which
 * value should win -- which the store cannot know.
 *
 * WIRED.
 */
declare function nts_jvm_store_open(namespace: string, key: string): number;

/** Appends a caller's window. Nothing is visible until the commit. WIRED. */
declare function nts_jvm_store_append(handle: number, from: JvmBytes): void;

/**
 * Makes everything appended visible under the key, atomically and durably.
 *
 * Durably is two syncs and not one: the file's, so the bytes are on the disk,
 * and the containing directory's, so the rename that published them is too.
 *
 * WIRED.
 */
declare function nts_jvm_store_commit(handle: number): void;

/** Abandons a write and releases the key. Idempotent, and a no-op once committed. WIRED. */
declare function nts_jvm_store_discard(handle: number): void;

/** The value's full size, or `-1` when absent. Writes as much of it as fits. WIRED. */
declare function nts_jvm_store_read(namespace: string, key: string, into: JvmBytes): number;

/** Removes a key. Absent is not an error; the answer says whether anything went. WIRED. */
declare function nts_jvm_store_delete(namespace: string, key: string): boolean;

/**
 * One snapshot of a namespace's records; answers the total byte length needed.
 *
 * `size NUL modified NUL keyByteLength NUL key` per record, concatenated. The
 * explicit key length is what lets them be concatenated and still parsed when a
 * key contains a separator, which a key may -- a key is an arbitrary string.
 *
 * One call rather than a count and a lookup per key: two calls cannot be
 * atomic, so a key created or removed between them makes the metadata disagree
 * with the names and the caller cannot tell which half is stale.
 *
 * WIRED.
 */
declare function nts_jvm_store_list(namespace: string, into: JvmBytes): number;

/** Total committed bytes in a namespace. WIRED. */
declare function nts_jvm_store_size(namespace: string): number;

/**
 * An independent ranged view, or `-1` when the key is absent.
 *
 * Independent is load-bearing: every consumer gets its own position, so two
 * readers of one value cannot move each other.
 *
 * A range that does not fit the value is **refused, not clamped**. A caller
 * asked for a range of *that* value; if the key was replaced between being
 * sized and being opened, a prefix of the new one is not a shorter answer to
 * that question but an answer to a different one, returned without saying so.
 * Once open, the descriptor pins what it was opened over, so a later commit
 * cannot change what this view sees.
 *
 * WIRED.
 */
declare function nts_jvm_store_source_open(
  namespace: string,
  key: string,
  start: number,
  length: number,
): number;

/** The next chunk into a caller's window; how many bytes, or `-1` at the end. WIRED. */
declare function nts_jvm_store_source_read(handle: number, into: JvmBytes): number;

/** Closes a ranged view. Safe on success, after a failed read, and twice. WIRED. */
declare function nts_jvm_store_source_close(handle: number): void;

/** The value's byte length, or `-1` when the key is absent. WIRED. */
declare function nts_jvm_store_source_size(namespace: string, key: string): number;
