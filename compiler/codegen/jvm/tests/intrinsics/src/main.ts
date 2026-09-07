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
// Five of nine. Four take only `number` and `void`; the fifth takes a byte
// view, which `ManagedType::View` supplied. The remaining four want an
// environment handle, which has no common type -- see
// `runtime/web-platform/android/intrinsics.d.ts`, where the gated entries say
// so. They are named rather than silently the ones that happened to work.
//
// The declarations are not here. They come from
// `runtime/web-platform/android/intrinsics.d.ts` through this fixture's
// tsconfig, so calling one with the wrong arity or the wrong type stops
// compiling. Restating them here compiled just as well and asserted nothing --
// which is what four hand-written copies of one ABI buys.
//
// And the calls go through `socket.ts` rather than naming the flat intrinsics,
// because that is how a provider will be written: the FFI spelling named once,
// in one module, and `openCount()` everywhere else. It also puts that module on
// the path this test already walks, so the wrapper is compiled by the JVM
// backend rather than merely typechecked.

import * as socket from "../../../../../../runtime/web-platform/android/socket.ts";

/**
 * How many connections the provider is holding.
 *
 * Named `openNow` rather than `openCount` because the wrapper exports that name
 * too, and two modules exporting one name is a collision the backend resolves
 * by qualifying both -- `openCount@socket` and `openCount@main`. Correct, and
 * invisible to a driver that reflects for `openCount`. Renaming the probe keeps
 * this test about the intrinsic boundary rather than about name mangling, which
 * has its own tests.
 */
export function openNow(): number {
  return socket.openCount();
}

/** Close one, and report what is left -- so the close is observable, not assumed. */
export function closeOne(handle: number): number {
  socket.close(handle);
  return socket.openCount();
}

/**
 * Cancelling a request that was never issued is idempotent and must disturb
 * nothing. The count is returned rather than nothing at all because "did not
 * throw" is a weaker claim than "did not close someone else's socket", and the
 * second is the one that matters during teardown.
 */
export function cancelUnissued(request: number): number {
  socket.cancelConnect(request);
  return socket.openCount();
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
  return socket.networkChanged();
}

/**
 * Fill thirty-two bytes and report how many are not zero.
 *
 * A stub that did nothing answers 0, which is what this distinguishes. It is
 * not a test of randomness -- that is `SecureRandom`'s job and not something a
 * corpus can assert -- it is a test that the bytes crossed the boundary at all.
 *
 * Thirty-two rather than one: a single byte is zero once in every 256 fills,
 * which would be a flaky test. All thirty-two being zero has probability 2^-256,
 * which is below the rate at which the hardware gets arithmetic wrong.
 */
export function randomBytes(): number {
  const bytes = new Uint8Array(32);
  socket.randomFill(bytes);
  let set = 0;
  for (let i = 0; i < 32; i = i + 1) {
    if (bytes[i]! !== 0) {
      set = set + 1;
    }
  }
  return set;
}

// `randomStaysInsideItsWindow` was here and cannot be: `new Uint8Array(backing,
// 8, 16)` is `NTS1001 a \`new Uint8Array\` from a value is not supported by this
// lowering yet`, so a window cannot be constructed in TypeScript at all. The
// property is real and is asserted in `Drive.java`, where a window can be built
// -- named here rather than left out, because a fill that ignored the view's
// offset would pass every case above.
