// TypeScript calling the fixed networking intrinsics, compiled to JVM.
//
// The plan says host Java tests alone are insufficient, and it is right: every
// test this lane had drove `nts.rt` from a Java `main`, which proves the
// runtime works and proves nothing about whether a *program* can reach it.
// Between the two sits the extern table, and a name missing from it is a
// refusal no amount of Java testing can see. This fixture existed for one
// minute in a form where every function returned zero, which would have passed
// against a table that mapped all four names to the wrong method.
//
// Only the intrinsics whose whole signature is `number` and `void` are here.
// The rest take an environment handle or a byte view, and neither has a common
// type yet -- see `runtime/web-platform/android/intrinsics.d.ts`, where the
// gated entries say so. Four of nine, and the four are named rather than
// silently the ones that happened to work.

declare function nts_jvm_web_open_count(): number;
declare function nts_jvm_web_network_changed(): number;
declare function nts_jvm_web_close(handle: number): void;
declare function nts_jvm_web_cancel_connect(request: number): void;

/** How many connections the provider is holding. */
export function openCount(): number {
  return nts_jvm_web_open_count();
}

/** Close one, and report what is left -- so the close is observable, not assumed. */
export function closeOne(handle: number): number {
  nts_jvm_web_close(handle);
  return nts_jvm_web_open_count();
}

/**
 * Cancelling a request that was never issued is idempotent and must disturb
 * nothing. The count is returned rather than nothing at all because "did not
 * throw" is a weaker claim than "did not close someone else's socket", and the
 * second is the one that matters during teardown.
 */
export function cancelUnissued(request: number): number {
  nts_jvm_web_cancel_connect(request);
  return nts_jvm_web_open_count();
}

/**
 * The default network changed: every connection on the old one is gone, and
 * this reports how many that was.
 *
 * Not a no-op that waits for the reads to fail. A socket on a replaced network
 * reports nothing for as long as the kernel will allow, so the failure a
 * program eventually sees is a timeout arriving long after its cause.
 */
export function changed(): number {
  return nts_jvm_web_network_changed();
}
