// The intrinsics, as a module.
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
// Connect, read, write, random-fill and the two completion reservations. They
// take an environment handle or a byte view and cannot be written in TypeScript
// yet; see the GATED markers in `intrinsics.d.ts`. Wrapping them here with
// `unknown` in the gaps would make this module look complete and make the gap
// invisible, which is the opposite of what a boundary is for.

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
