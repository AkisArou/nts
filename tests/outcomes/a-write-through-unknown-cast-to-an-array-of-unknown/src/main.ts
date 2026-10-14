// **Stops by name, where it answered wrong.** An `unknown` cast to
// `unknown[]` was unerased as `managed<[erased]>` whatever array it held, so a
// `number[]` behind it was believed to hold sixteen-byte `NtsValue`s, and a
// write stored one into an eight-byte `double` slot. node answers `n + 1`; C
// and LLVM read back the value's bits, `1e-323` and the like, until 2026-10-10.
//
// Now the claim is checked where it is made, as an unerase to a class is: an
// array read out of an erased value as an array of erased values must be one,
// or the program stops naming it -- `refused at run time: an array read as
// `unknown[]` whose elements are not erased values`. The JVM already stopped
// here, less legibly: its unerase is a `checkcast` that throws
// `ClassCastException` on a `[D`. Reads through the cast stop too, on every
// backend now, for the same reason.
//
// What lifts it is an array whose element kind is read at run time, which
// every read and write through the cast would go through; until a program
// needs one, `Array.isArray(h)` narrowing reads any array, keeping the value
// erased.
//
// The control is the other half: `as number[]` names the element the array has,
// and the same write through it agrees.
//
// Found on 2026-10-10 writing the written-kind array guard for scalar 2f.

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
