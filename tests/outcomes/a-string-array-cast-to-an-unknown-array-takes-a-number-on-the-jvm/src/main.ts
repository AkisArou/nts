// run: check
// backend: jvm
//
// **Stops by name on the JVM, where it took a number into a `string[]`.** An
// `unknown` cast to `unknown[]` is checked on C and LLVM since 36f49b76f
// (`nts_array_of_values`: the array must hold erased values, otherwise it
// stops by name). The JVM's check was the `checkcast` the unerase already
// spelled, and it names the *class*, not the element: a growable `string[]`,
// a `Box[]` and an `unknown[]` are all `nts/rt/NtsArrayL`, so the cast passed
// and `NtsArrayL.set`/`push` stored an `NtsValue` among the strings or boxes.
// node answers `number:2`; the JVM answered `string:2`, and `object` for the
// pushed element, until 2026-10-10.
//
// What C reads, the JVM now carries too: `NtsArrayL.values`, set by the
// factories that make an `unknown[]` (`ofValues`) and kept by its copies, and
// read by `NtsValue.arrayOfValues` at the unerase, which stops in C's words.
// A `number[]` is `NtsArrayD` or `[D`, which the `checkcast` rejected with a
// `ClassCastException`; that is the named stop now as well.
//
// The control, `aRealUnknownArray`: the same write through a real `unknown[]`
// agrees on every backend. What lifts the stop is an array whose element kind
// is read at run time (`outcomes/a-write-through-unknown-cast-to-an-array-of-unknown`).
//
// Found on 2026-10-10 by the JVM lane, checking 36f49b76f on the JVM.

class Box {
  v = 1;
}

export function aStringArray(n: number): string {
  const xs: string[] = [];
  xs.push(String(n));
  xs.push("b");
  const h: unknown = xs;
  (h as unknown[])[0] = n + 1;
  return typeof xs[0] + ":" + xs.length;
}

export function aBoxArray(n: number): string {
  const xs: Box[] = [];
  xs.push(new Box());
  const h: unknown = xs;
  (h as unknown[]).push(n);
  return String(xs.length) + ":" + typeof xs[1];
}

/** The control: the same write through a real `unknown[]`, which agrees. */
export function aRealUnknownArray(n: number): string {
  const xs: unknown[] = [];
  xs.push(String(n));
  xs.push("b");
  const h: unknown = xs;
  (h as unknown[])[0] = n + 1;
  return typeof xs[0] + ":" + xs.length;
}
