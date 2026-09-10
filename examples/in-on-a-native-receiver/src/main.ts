// `"k" in v` where the *representation* already says what `v` is.
//
// `"length" in xs` with `xs: number[]` was refused, and the message was
//
//     an `in` on something that is not an object, which JavaScript throws for
//
// which is a sentence about an array. An array is an object in every sense the
// language has; what it is not is `TypeKind::Object`, and the path that answers
// `in` asks which of a type's *declared members* have the name. An array
// declares none, so it fell to the arm written for primitives and borrowed
// their message — a refusal that told the reader their program was wrong.
//
// The answer is a constant and the natives table already held it: an array has
// a `length`, a `Map` and a `Set` have a `size`, a `Promise` has a `then`, a
// typed array and a `DataView` sit on a `buffer` at a `byteOffset`.
//
// # Only the `true` direction, and the reason is a prototype
//
// A name the table does not list is not therefore absent. `"push" in xs` is
// `true` in JavaScript and `push` lives on `Array.prototype`, which a compiled
// program does not have — so answering `false` for the names the table omits
// would be a wrong answer, and those still refuse. That is why every case below
// is `true` on its own, and why none of them is alone in its function.
//
// # A fixture whose every answer is `true` proves nothing
//
// So each case is paired with one that must be `false`, through the path that
// can produce one: `"zzz" in` a class instance. A lowering that answered `true`
// for everything would agree with node on the first half of each number and
// disagree on the second, and the number is what is compared.

class Thing {
  present: number;
  constructor(n: number) {
    this.present = n;
  }
}

/** The pair for every case: a path that really can answer `false`. */
function absent(n: number): number {
  return "zzz" in new Thing(n) ? 1 : 0;
}

/** And its own control, so `absent` is not silently the constant it looks like. */
export function theFalseSideAnswersEitherWay(n: number): number {
  const t = new Thing(n);
  return ("present" in t ? 2 : 0) + ("zzz" in t ? 1 : 0);
}

export function lengthOfAnArray(n: number): number {
  const xs: number[] = [1, 2, n];
  return ("length" in xs ? 2 : 0) + absent(n);
}

export function lengthOfATypedArray(n: number): number {
  const xs = new Uint8Array(3);
  xs[0] = n;
  return ("length" in xs ? 2 : 0) + absent(n);
}

export function sizeOfAMap(n: number): number {
  const m = new Map<string, number>();
  m.set("a", n);
  return ("size" in m ? 2 : 0) + absent(n);
}

export function sizeOfASet(n: number): number {
  const s = new Set<number>();
  s.add(n);
  return ("size" in s ? 2 : 0) + absent(n);
}

export function thenOfAPromise(n: number): number {
  const p = Promise.resolve(n);
  return ("then" in p ? 2 : 0) + absent(n);
}

export function byteLengthOfAnArrayBuffer(n: number): number {
  const b = new ArrayBuffer(4);
  return ("byteLength" in b ? 2 : 0) + absent(n);
}

export function overABufferAtAnOffset(n: number): number {
  const d = new DataView(new ArrayBuffer(4));
  d.setUint8(0, n & 0xff);
  return ("buffer" in d ? 4 : 0) + ("byteOffset" in d ? 2 : 0) + absent(n);
}

/** Control: the whole-program path, which this change must not have touched. */
export function throughAnObject(n: number): number {
  const v: object = n > 0 ? new Thing(n) : new Thing(-n);
  return ("present" in v ? 2 : 0) + ("zzz" in v ? 1 : 0);
}
