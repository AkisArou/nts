// The statics a *type* already answers.
//
// `Array.isArray(x)` is a constant wherever the argument has a static type, and
// so is `Object.hasOwn(o, "k")` wherever the layout is known: there is nothing
// to ask at run time, because the question was settled when the type was.
// `Object.keys(o)` is the same fact one step further — the field names of a
// layout, which is a list the compiler is already holding.
//
// The subtlety is *which* type answers. `Array.isArray(new Uint8Array(4))` is
// **false** in node -- a typed array is not an Array -- and a `Uint8Array` was
// a `Managed(Array(u8))` here, so reading the representation would have
// answered `true`. That is why the question goes to the checker's type.
//
// It is also why the OPEN case was refused for as long as this file has
// existed, and why it no longer is. Where the checker leaves the type open the
// answer cannot come from a type, and the refusal said the runtime could not
// supply one either, because `number[]` and `Float64Array` were one
// representation and node answers differently for them. `ManagedType::View`
// separated them, and a descriptor kind now answers exactly the question node
// answers. The second half of this file is that case.

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

// Declaration order, which is what a layout is: fields are laid out base-first
// and in the order the class declares them, and that is the order `Object.keys`
// is specified to produce.
export function keys(n: number): number {
  const p = new Point(n, n * 2);
  const k = Object.keys(p);
  return k.length * 1000 + k[0].length * 100 + k[1].length * 10 + (k[0] === "x" ? 1 : 0);
}

export function hasOwn(n: number): number {
  const p = new Point(n, n);
  return (Object.hasOwn(p, "x") ? 1 : 0) +
    (Object.hasOwn(p, "y") ? 10 : 0) +
    (Object.hasOwn(p, "nope") ? 100 : 0) +
    n * 0;
}

// A subclass sees its base's fields too, because a layout is base-first.
class Point3 extends Point {
  z: number;
  constructor(x: number, y: number, z: number) {
    super(x, y);
    this.z = z;
  }
}

export function inherited(n: number): number {
  const p = new Point3(n, n, n);
  const k = Object.keys(p);
  return k.length * 100 + (Object.hasOwn(p, "x") ? 10 : 0) + (Object.hasOwn(p, "z") ? 1 : 0);
}

// The case where representation and semantics disagree.
export function isArray(n: number): number {
  const xs = [n, n + 1];
  const pair: [number, string] = [n, "a"];
  const bytes = new Uint8Array(2);
  const p = new Point(n, n);
  return (Array.isArray(xs) ? 1 : 0) +
    (Array.isArray(pair) ? 10 : 0) +
    (Array.isArray(bytes) ? 100 : 0) +
    (Array.isArray(p) ? 1000 : 0) +
    (Array.isArray(n) ? 10000 : 0);
}

// `BigInt.asIntN` is how the profile reads a signed 64-bit quantity back out of
// an unsigned one — `readBigInt64BE` is exactly this over `readBigUInt64BE`.
export function widths(n: number): number {
  const all = 0xffffffffffffffffn;
  const signed = BigInt.asIntN(64, all);
  return (signed === -1n ? 1 : 0) +
    (BigInt.asUintN(64, signed) === all ? 10 : 0) +
    (BigInt.asIntN(8, 255n) === -1n ? 100 : 0) +
    (BigInt.asUintN(8, -1n) === 255n ? 1000 : 0) +
    n * 0;
}

// A width that keeps nothing and one that keeps everything, which are the two
// ends C cannot shift by.
export function widthEdges(n: number): number {
  return (BigInt.asUintN(0, 12345n) === 0n ? 1 : 0) +
    (BigInt.asIntN(1, 1n) === -1n ? 10 : 0) +
    (BigInt.asUintN(1, 3n) === 1n ? 100 : 0) +
    (BigInt.asIntN(4, 9n) === -7n ? 1000 : 0) +
    n * 0;
}

// ---------------------------------------------------------------------------
// The same question where no type answers it.
//
// Everything below puts a value in an `unknown` first, so the call site sees a
// type that decides nothing and the answer has to come from the value. It is
// one runtime test -- the descriptor's kind -- and these are the cases that
// separate it from every wrong version of itself.

export function openArray(n: number): number {
  const open: unknown = [n, n + 1];
  return Array.isArray(open) ? 1 : 0;
}

// The case the refusal existed for. A typed array is a window onto a buffer and
// carries an object's kind, so this is `false` -- and it was unanswerable while
// a `Uint8Array` and a `number[]` were one representation with one descriptor.
export function openTypedArray(n: number): number {
  const bytes = new Uint8Array(n > 0 ? 2 : 1);
  const open: unknown = bytes;
  return Array.isArray(open) ? 1 : 0;
}

// And the buffer underneath it, which is not an Array either.
export function openBuffer(n: number): number {
  const open: unknown = new ArrayBuffer(n > 0 ? 2 : 1);
  return Array.isArray(open) ? 1 : 0;
}

// A HETEROGENEOUS TUPLE, which is the case that made this more than a
// one-line runtime test. The language calls a tuple an Array; this compiler
// lays `[number, string]` out as a struct, because its elements have different
// types. So the descriptor kind said "object" and node said `true`, and the
// first version of this change was wrong on exactly this input -- twenty-nine
// disagreements, against a comment of mine asserting a tuple could not reach
// here because the checker knows one statically. It reaches here through an
// `unknown`.
//
// `NTS_KIND_TUPLE` is what the fix is: a kind that manages no storage and
// exists only so this line can be answered.
export function openHeterogeneousTuple(n: number): number {
  const pair: [number, string] = [n, "a"];
  const open: unknown = pair;
  return Array.isArray(open) ? 1 : 0;
}

// And the homogeneous one, which is laid out as an array and was never in
// doubt -- kept because it is what makes the case above a *tuple* case rather
// than a struct case, and because a fix that gave every tuple the struct
// treatment would still pass without it.
export function openHomogeneousTuple(n: number): number {
  const pair: [number, number] = [n, n];
  const open: unknown = pair;
  return Array.isArray(open) ? 1 : 0;
}

// The three that are not references at all, or are the wrong kind of one.
export function openScalar(n: number): number {
  const open: unknown = n;
  return Array.isArray(open) ? 1 : 0;
}

export function openString(n: number): number {
  const open: unknown = n > 0 ? "abc" : "d";
  return Array.isArray(open) ? 1 : 0;
}

export function openObject(n: number): number {
  const open: unknown = new Point(n, n);
  return Array.isArray(open) ? 1 : 0;
}

// A union rather than `unknown`, so the checker has two candidates and still
// cannot fold: one arm is an Array and the other is not.
export function openUnion(n: number): number {
  const either: number[] | string = n > 0 ? [n] : "no";
  return Array.isArray(either) ? 1 : 0;
}
