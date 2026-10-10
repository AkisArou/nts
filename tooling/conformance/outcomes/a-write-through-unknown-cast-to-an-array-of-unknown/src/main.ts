// **Writes an erased value into a `number[]`'s double slot.** An `unknown`
// cast to `unknown[]` is unerased as `managed<[erased]>` whatever array it
// holds, so a `number[]` behind it is believed to hold sixteen-byte `NtsValue`s.
// An element *read* re-erases first and dispatches on the array's real element
// kind, which is why reads agree; an element *write* stores an `NtsValue` into
// an eight-byte `double` slot. node answers `n + 1`; C and LLVM read back the
// value's bits, `1e-323` and the like.
//
// The JVM does not get this far: the `unerase` is a `checkcast
// [Lnts/rt/NtsValue;` on a `[D`, a `ClassCastException` at the cast. The
// static claim is the same on every backend and false on all of them; only the
// JVM checks it.
//
// The controls are each case's other half: `as number[]` names the element the
// array has, and the same write through it agrees. `Array.isArray(h)` narrowing
// instead of a cast also agrees, and reads through the cast agree today, so
// this is about the write.
//
// Found on 2026-10-10 writing the written-kind array guard for scalar 2f.
//
// The `push` and `for ... of` shapes of the same cast abort, which a build
// cannot observe past; they are not in this program for that reason.

function throughUnknownArray(n: number): string {
  const xs: number[] = [n, 2];
  const h: unknown = xs;
  (h as unknown[])[0] = n + 1;
  // Compared, not printed: what it reads instead is another
  // representation's bits.
  return xs[0] === n + 1 ? "n + 1" : "not n + 1";
}

function throughNumberArray(n: number): string {
  const xs: number[] = [n, 2];
  const h: unknown = xs;
  (h as number[])[0] = n + 1;
  return xs[0] === n + 1 ? "n + 1" : "not n + 1";
}

observe("as unknown[]", throughUnknownArray(3));
observe("as number[]", throughNumberArray(3));
done();
