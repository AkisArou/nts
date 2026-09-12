// `for (const k in o)`, which refused until 2026-09-12.
//
// # It is the same loop over a different sequence
//
// `for...of` walks a value's elements; `for...in` walks its keys. Everything
// after that is identical — the cursor, the latch, `break`, `continue` and the
// loop-carried names — so this is one `lower_for_of` taking which sequence it
// wants rather than a second loop that would drift from the first. The file
// already argues that for the three shapes `for...of` walks; this is a fourth
// on the same grounds.
//
// The keys are the layout's field names, in the order the program wrote them,
// which is the same list `Object.keys` answers and for the same reason: a
// compiled object has no insertion order, so the layout *is* the order, and
// that is what the specification asks for.
//
// # Why the two JavaScript differences both vanish here
//
// `for...in` differs from `Object.keys` in two ways: it walks the prototype
// chain, and it reports inherited *enumerable* properties. A compiled class
// keeps its methods on the descriptor rather than as own properties, so there
// is no chain to walk and nothing enumerable to inherit. Both questions have
// the answer "none", which is why one list serves both — and `methodsAreNotOwn`
// is the case that would catch it if a method ever became an own property.
//
// # What is refused, and why it is not the same list
//
// `for...in` over an **array** answers its indices *as strings* — `"0"`, `"1"`
// — which is neither the layout's field names nor anything this builds. It is
// refused by name rather than answered with the wrong list, and the refusal
// says `for...in` rather than mentioning the `Object` static this shares a
// helper with, which the source never wrote.

class Point {
  x: number;
  y: number;
  constructor(n: number) {
    this.x = n;
    this.y = n + 1;
  }
}

/** Control: the same keys through `Object.keys`, which worked before this. */
export function viaObjectKeys(n: number): number {
  const p = new Point(n & 7);
  let total = 0;
  for (const k of Object.keys(p)) total += k.length;
  return total;
}

/** Under test: the loop itself. */
export function overAnObject(n: number): number {
  const p = new Point(n & 7);
  let total = 0;
  for (const k in p) total += k.length;
  return total;
}

/** Under test: `break` reaches the latch, as it does in every other walk. */
export function withBreak(n: number): number {
  const p = new Point(n & 7);
  let total = 0;
  for (const k in p) {
    if (k === "y") break;
    total += 1;
  }
  return total;
}

/** Under test: `continue`, which is the other half of that. */
export function withContinue(n: number): number {
  const p = new Point(n & 7);
  let total = 0;
  for (const k in p) {
    if (k === "x") continue;
    total += 1;
  }
  return total;
}

class WithMethod {
  a: number;
  constructor(n: number) {
    this.a = n;
  }
  twice(): number {
    return this.a * 2;
  }
}

/**
 * Under test, and the case that makes the prototype question observable: a
 * class with a method has **one** key, not two. A lowering that listed the
 * dispatch table as well would answer 2 and still run.
 */
export function methodsAreNotOwn(n: number): number {
  const w = new WithMethod(n & 7);
  let total = 0;
  for (const k in w) total += 1;
  return total;
}

/** Under test: nested walks are independent, which the shared cursor decides. */
export function nested(n: number): number {
  const p = new Point(n & 7);
  let total = 0;
  for (const a in p) {
    for (const b in p) total += a.length + b.length;
  }
  return total;
}
