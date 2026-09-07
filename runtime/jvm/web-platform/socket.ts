// The networking intrinsics, as a module.
//
// `nts_jvm_web_open_count()` is what the compiler needs: a free function that
// lowers to `Callee::External` and becomes one `invokestatic`. It is not what a
// caller should have to write. This module is the difference -- the flat names
// are named once, here, and everything else writes `openCount()`.
//
// The same arrangement `runtime/node/internal/uv.ts` uses for
// `nts_uv_err_name`, and for the same reason: an FFI import is a spelling the
// linker needs, not a vocabulary a program should be written in.
//
// # Why not `import { NtsSocket } from "nts.rt"`
//
// Because there is nothing behind it. A class-shaped import promises instance
// methods and a constructor, and `nts.rt.NtsSocket` is a static-only holder --
// `new NtsSocket()` would be a type error at best and a link error at worst.
// The import that *should* exist is `java:okhttp3`, resolved against the pinned
// jar; that needs a class-file reader and is written up in
// `docs/jvm-android-provider.md`. This module is what the ergonomics look like
// without it, which is most of them.
//
// # What is not here
//
// The durable store, which is `store.ts` -- one module per family rather than
// one module for the table, so that adding a family does not make this file the
// place everything lands. `the_declarations_the_table_and_the_jar_agree` asserts
// that every declaration has a wrapper in *some* module here, which is what
// keeps that split honest rather than a convention.
//
// Of the networking family, nothing. Every one of them has a wrapper below.
// Connect, read and write were gated on an environment handle that turned out
// to be redundant -- the environment is ambient in both runtimes -- and
// random-fill was gated on a byte view, which `ManagedType::View` supplied.
// The two completion reservations are withdrawn rather than missing; the
// declarations say why.

/**
 * How many connections the provider is holding.
 *
 * For backpressure reporting and for tests. Not a health check: a provider with
 * zero open connections is idle, not broken.
 */
export function openCount(): number {
  return nts_jvm_web_open_count();
}

/**
 * Close a connection. Idempotent, safe on a handle that was never issued, and
 * what makes a blocked read or write return.
 *
 * Called during teardown, which is why it must not throw on a handle it does
 * not recognise: a shutdown path that can fail is one that leaves sockets open.
 */
export function close(handle: number): void {
  nts_jvm_web_close(handle);
}

/**
 * Abandon an in-flight connect. Idempotent, safe from any lane, and a late
 * success still closes its socket rather than leaking it.
 */
export function cancelConnect(request: number): void {
  nts_jvm_web_cancel_connect(request);
}

/**
 * The default network changed: every connection on the old one is gone, and
 * this reports how many that was.
 *
 * Not a no-op that waits for the reads to fail. A socket on a replaced network
 * reports nothing for as long as the kernel will allow, so the failure a
 * program eventually sees is a timeout arriving long after its cause. Every
 * in-flight completion still arrives, because closing under a blocked worker is
 * what unblocks it.
 */
export function networkChanged(): number {
  return nts_jvm_web_network_changed();
}

/**
 * Fill a byte view with secure random bytes, in place.
 *
 * In place because `getRandomValues` is specified as filling the array it was
 * given, and because a provider that allocated one would leave the caller
 * copying out of it.
 *
 * Fills the view's **window**, not its buffer. A `Uint8Array` may be a view onto
 * part of a larger `ArrayBuffer`, and the bytes outside it belong to whatever
 * else is looking at that buffer.
 */
export function randomFill(into: Uint8Array): void {
  nts_jvm_web_random_fill(into);
}

/** No proxy. */
export const DIRECT = 0;
/** An HTTP proxy, reached with `CONNECT` and tunnelled through. */
export const HTTP_PROXY = 1;
/** A SOCKS proxy, which the platform speaks below TLS. */
export const SOCKS_PROXY = 2;

/**
 * Connect, optionally through a proxy. Answers a cancellation handle at once;
 * every callback happens later, including the ones already decided.
 *
 * TLS through a `CONNECT` tunnel verifies the certificate against the
 * **target**, never the proxy.
 */
export function connect(
  host: string,
  port: number,
  secure: boolean,
  timeoutMs: number,
  proxyHost: string | null,
  proxyPort: number,
  proxyKind: number,
  onOpen: (handle: number) => void,
  onError: (code: string, message: string) => void,
): number {
  return nts_jvm_web_connect(
    host, port, secure, timeoutMs, proxyHost, proxyPort, proxyKind, onOpen, onError,
  );
}

/**
 * Read into a caller-owned view. `onRead` reports the count, or -1 at end of
 * stream.
 *
 * The view's own window, so a view onto part of a buffer reads only its own
 * bytes.
 */
export function read(
  handle: number,
  into: Uint8Array,
  onRead: (count: number) => void,
  onError: (code: string, message: string) => void,
): void {
  nts_jvm_web_read(handle, into, onRead, onError);
}

/** Write from a caller-owned view, borrowed until the completion. */
export function write(
  handle: number,
  from: Uint8Array,
  onWrote: (count: number) => void,
  onError: (code: string, message: string) => void,
): void {
  nts_jvm_web_write(handle, from, onWrote, onError);
}

/**
 * The proxy result string for a URL, or `"DIRECT"` when the platform has none.
 *
 * The classic auto-configuration grammar -- `PROXY host:port`, `SOCKS5
 * host:port`, `SOCKS host:port`, `DIRECT`, joined with `"; "` -- which the
 * shared lane parses. This side only formats; the parser lives there, with its
 * own tests, and a second one here would be a second answer.
 *
 * Never `null` on this provider: Android answers exactly one `DIRECT` when
 * nothing is configured rather than an empty list, so there is always a string.
 */
export function systemProxyFor(url: string): string {
  return nts_jvm_web_system_proxy_for(url);
}
