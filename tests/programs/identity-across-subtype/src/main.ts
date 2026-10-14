// `===` between a subtype and its base, which is address equality.
//
// This exists because of an argument rather than a bug report. The fix that
// made it correct — `specialize::comparison_type` unifying only when *both*
// operands are numbers — landed with no example, and the JVM lane pointed out
// that "I have not seen that verifier error" and "that shape has never reached
// this backend" are the same observation until something separates them.
//
// What the fix repaired: `comparison_type` fell back to comparing in doubles
// whenever the two operands were spelled differently, on the argument that
// every integer this pass produces is exact as an `f64`. Sound for numbers, and
// false for anything else — so a reference compared against a base emitted
// `(double)v3` on a pointer, which is not C at all. A subtype and its base are
// *always* spelled differently, so this was every such comparison.
//
// Found by the node lane in `MemoryHttpCacheStore.touch`, as `candidate ===
// entry` in a linear scan over `interface MemoryEntry extends HttpCacheEntry`.
// There is no other way to write that loop.
//
// Identity does not care which class either side was declared as: base-first
// layout puts a derived object and its base at the same address, which is what
// makes the question answerable. C is told with a cast to the header they both
// begin with; the JVM compares references and needs nothing.

class Entry {
  key: number;
  constructor(key: number) {
    this.key = key;
  }
}

class Extended extends Entry {
  extra: number;
  constructor(key: number, extra: number) {
    super(key);
    this.extra = extra;
  }
}

// The shape it was found in: a scan comparing each candidate against a held
// reference, where the two are declared at different levels of one hierarchy.
export function findsItself(n: number): number {
  const held = new Extended(n, n + 1);
  const entries: Entry[] = [new Entry(n), held, new Entry(n + 2)];
  let at = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]! === (held as Entry)) {
      at = i;
    }
  }
  return at;
}

// Two distinct objects with equal contents are not identical, which is what
// makes this address equality rather than a comparison of fields.
export function equalIsNotIdentical(n: number): number {
  const one = new Extended(n, n);
  const other = new Extended(n, n);
  const base: Entry = one;
  return (base === (one as Entry) ? 1 : 0) + (base === (other as Entry) ? 2 : 0);
}

// The negation, so the operator is not right by one arm.
export function differs(n: number): number {
  const first: Entry = new Extended(n, n);
  const second: Entry = new Entry(n);
  return first !== second ? 1 : 0;
}

// Through a parameter declared at the base, which is where a scan actually
// meets it: the caller knows the derived type and the callee does not.
function contains(entries: Entry[], wanted: Entry): number {
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]! === wanted) {
      return i;
    }
  }
  return -1;
}

export function throughAParameter(n: number): number {
  const held = new Extended(n, n + 1);
  return contains([new Entry(n), held], held);
}

// The same class on both sides, which needed no cast and must keep working.
export function sameClassBothSides(n: number): number {
  const one = new Entry(n);
  const two = new Entry(n);
  return (one === one ? 1 : 0) + (one === two ? 2 : 0);
}
