// run: check
// backend: jvm
//
// **A JVM-only wrong answer: a number written into a `string[]`.** An
// `unknown` cast to `unknown[]` is checked on C and LLVM since 36f49b76f
// (`nts_array_of_values`: the array must hold erased values, otherwise it
// stops by name). The JVM's check is the `checkcast` the unerase already
// spelled, and it names the *class*, not the element: a growable `string[]`,
// a `Box[]` and an `unknown[]` are all `nts/rt/NtsArrayL`, so the cast passes
// and `NtsArrayL.set`/`push` store an `NtsValue` among the strings or boxes.
// node answers `number:2`; the JVM answers `string:2`, and `object` for the
// pushed element. A `number[]` is `NtsArrayD` or `[D`, which the `checkcast`
// does reject -- a `ClassCastException`, not a named stop, which is a second
// and smaller difference from C.
//
// What C reads that the JVM cannot: `descriptor->erased`, a fact about the
// array's elements carried by the array. `NtsArrayL` carries nothing of the
// kind, so a fix needs one -- or a separate class for arrays of values.
//
// The controls: the same writes through a real `unknown[]` agree, and the same
// program on C and LLVM stops by name ("an array read as `unknown[]` whose
// elements are not erased values").
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
