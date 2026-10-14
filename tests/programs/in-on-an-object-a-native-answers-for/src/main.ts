// `"k" in v` where `v` is `object` and `k` is a name a natively represented
// type answers for.
//
// The whole-program answer asks which of the program's object types declare the
// name and compares the value's descriptor against each. That is complete for
// classes and blind to everything else: an array, a `Map`, a `Set`, a
// `Promise`, a typed array and an `ArrayBuffer` are all `object` and none has a
// layout in `program.layouts` to find a name on — so the comparison found
// nothing and the expression folded to `false` where JavaScript says `true`.
//
// It was refused rather than answered wrongly, by a list of the names it would
// have got wrong. 50 sites across `runtime/node`, of which 27 are `"then" in
// value` — which is how every thenable test in the corpus is written.
//
// What closed it is that none of these needs a layout. Each is one descriptor
// comparison the runtime already performs for `instanceof`, and a function is
// its *tag* rather than a call at all. So the refusal list became a table of
// tests, and the natives are folded onto the class answer with `||`.
//
// # Why every case walks every receiver
//
// The first version of this dispatched on `n % 10` and let the differential's
// pool pick `n`. **No value in that pool is congruent to 4 modulo 10**, so the
// `Promise` arm — the one 27 of the 50 sites are about — was never built, and
// deleting `Native::Promise` from the compiler left the example reporting
// "agreed on every case" over 290 of them. The instrument could not fail at the
// thing it was written for.
//
// A loop over all ten removes the harness's choice from the question: each case
// asks every receiver, so an arm that is never reached is a `0` bit in an
// answer node also computes rather than a case nobody ran.

class Thing {
  present: number;
  constructor(n: number) {
    this.present = n;
  }
}

/** A class that declares one of the names a native also answers for. */
class Sized {
  size: number;
  constructor(n: number) {
    this.size = n;
  }
}

/** Ten receivers, and `n` only varies what is in them. */
function receiver(which: number, n: number): object {
  if (which === 1) return [1, 2, n];
  if (which === 2) return new Map<string, number>();
  if (which === 3) return new Set<number>();
  if (which === 4) return Promise.resolve(n);
  if (which === 5) return new Uint8Array(4);
  if (which === 6) return new DataView(new ArrayBuffer(4));
  if (which === 7) return new ArrayBuffer(4);
  if (which === 8) return new Thing(n);
  if (which === 9) return new Sized(n);
  return { plain: n };
}

/** A `Promise` and nothing else. 27 of the 50 refused sites ask exactly this. */
export function thenable(n: number): number {
  let bits = 0;
  for (let i = 0; i < 10; i++) {
    if ("then" in receiver(i, n)) bits += 1 << i;
  }
  return bits;
}

/** The other two names on the same object, which must move together with it. */
export function catchAndFinally(n: number): number {
  let bits = 0;
  for (let i = 0; i < 10; i++) {
    const v = receiver(i, n);
    if ("catch" in v) bits += 1 << i;
    if ("finally" in v) bits += 1 << (i + 10);
  }
  return bits;
}

/**
 * A `Map` and a `Set` — one struct here and one descriptor, told apart by
 * whether the entries hold values — and a class that declares `size` itself,
 * so the class arm and the native arms both have to fire.
 */
export function sized(n: number): number {
  let bits = 0;
  for (let i = 0; i < 10; i++) {
    if ("size" in receiver(i, n)) bits += 1 << i;
  }
  return bits;
}

/**
 * An array has one and so does a typed array; a `DataView` does not, which is
 * the case a test of "is it a view" alone would get wrong.
 */
export function lengthy(n: number): number {
  let bits = 0;
  for (let i = 0; i < 10; i++) {
    if ("length" in receiver(i, n)) bits += 1 << i;
  }
  return bits;
}

/** A typed array and a `DataView` both sit on a buffer at an offset. */
export function overABuffer(n: number): number {
  let bits = 0;
  for (let i = 0; i < 10; i++) {
    const v = receiver(i, n);
    if ("buffer" in v) bits += 1 << i;
    if ("byteOffset" in v) bits += 1 << (i + 10);
  }
  return bits;
}

/** The one of the three an `ArrayBuffer` answers for too: it *is* the block. */
export function byteLength(n: number): number {
  let bits = 0;
  for (let i = 0; i < 10; i++) {
    if ("byteLength" in receiver(i, n)) bits += 1 << i;
  }
  return bits;
}

/** A function is not a descriptor comparison at all — it is a tag. */
export function functionNames(n: number): number {
  const f: object = (x: number): number => x + n;
  let bits = 0;
  if ("name" in f) bits += 4;
  if ("call" in f) bits += 2;
  if ("bind" in f) bits += 1;
  // And the pair for it: an object that is not a function has none of them.
  const o = receiver(8, n);
  if ("name" in o) bits += 32;
  if ("call" in o) bits += 16;
  if ("bind" in o) bits += 8;
  return bits;
}

/** Control: a name only a class declares, which was always right. */
export function declaredByAClass(n: number): number {
  let bits = 0;
  for (let i = 0; i < 10; i++) {
    if ("present" in receiver(i, n)) bits += 1 << i;
  }
  return bits;
}

/** Control: a name nothing has, whose `false` must survive the change. */
export function declaredByNothing(n: number): number {
  let bits = 0;
  for (let i = 0; i < 10; i++) {
    if ("zzz" in receiver(i, n)) bits += 1 << i;
  }
  return bits;
}

/** Every question at once, so one wrong receiver cannot hide behind nine. */
export function allOfThem(n: number): number {
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const v = receiver(i, n);
    total += ("then" in v ? 1 : 0) +
      ("size" in v ? 2 : 0) +
      ("length" in v ? 4 : 0) +
      ("buffer" in v ? 8 : 0) +
      ("byteLength" in v ? 16 : 0) +
      ("present" in v ? 32 : 0) +
      ("zzz" in v ? 64 : 0);
  }
  return total;
}
