// The statics a *type* already answers.
//
// `Array.isArray(x)` is a constant wherever the argument has a static type, and
// so is `Object.hasOwn(o, "k")` wherever the layout is known: there is nothing
// to ask at run time, because the question was settled when the type was.
// `Object.keys(o)` is the same fact one step further — the field names of a
// layout, which is a list the compiler is already holding.
//
// The subtlety is *which* type answers. A `Uint8Array` is a `Managed(Array(u8))`
// in this compiler, and `Array.isArray(new Uint8Array(4))` is **false** in
// node: a typed array is not an Array. Reading the representation would have
// answered `true` and been wrong in a way nothing else here would catch, so the
// question goes to the checker's type instead.

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
