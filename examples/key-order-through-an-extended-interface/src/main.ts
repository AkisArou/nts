// `Object.keys` on an object whose type *extends* another.
//
// JavaScript orders an object's own string keys by **insertion**, so
// `{ c, a, b }` written in that order answers `c, a, b` whatever its declared
// type says. A compiled object has no insertion order: it has a layout, and the
// layout's field order is what `Object.keys` walks.
//
// That makes field order serve two masters, and they pull in opposite
// directions:
//
//   - **Key order** wants the layout to match how the literal is written.
//   - **A pointer cast** wants the layout of a type that extends another to
//     begin with the base's fields, so that reading one as the other is free —
//     which is exactly what `class D extends B` gives and what
//     `interface E extends B` does not.
//
// This file exists because the second was attempted and this was the cost.
//
// # The measurement, both ways
//
// Laying an interface's inherited fields first — the change that would make
// `interface FileOptions extends BlobOptions` castable to `BlobOptions` for
// free, and clear 4 of the 75 structural-cast refusals in the corpus — takes
// this file from **29 of 29 agreeing with node to 0 of 29**. `{ c: n, a: 1,
// b: 2 }` answers `a, b, c` where node answers `c, a, b`.
//
// Four refusals traded for a wrong answer in every object of an extended
// interface type is not a trade this compiler makes, so the change was reverted
// and this file is what stops it being made again by someone who measures only
// the refusals. **Nothing in the gate saw it**: all 150 examples agreed, the
// refusal ledger was clean, clippy and the tests passed. It was found by asking
// what else field order decides.
//
// The real answer is to stop the two questions sharing one order — key order
// recorded per allocation site rather than read off the layout — which is a
// design step and not a reordering.
//
// # What this file cannot be, and the case that says why
//
// It cannot be a fixture for key order *being right*, because it is not. One
// layout is one order, and a literal can be written in any of them: with the
// layout as it stands, `{ c, a, b }` agrees with node and `{ a, b, c }` of the
// same type does not. That second case is in
// `tooling/conformance/agreements/key-order-of-an-extended-interface`, where a
// case that runs and disagrees belongs.
//
// So what this file guards is narrower and worth stating plainly: **the layout
// of an extended interface is derived-first, and changing it costs more than it
// buys.** The cases below pass because they are written in the order the layout
// happens to have. That is not a claim that the order is right; it is a claim
// that moving it moves these too, which is what an unmeasured reordering would
// not notice.

interface Base {
  a: number;
  b: number;
}

interface Extended extends Base {
  c: number;
}

class ClassBase {
  a: number;
  b: number;
  constructor(n: number) {
    this.a = n;
    this.b = 2;
  }
}

class ClassDerived extends ClassBase {
  c: number;
  constructor(n: number) {
    super(n);
    this.c = 3;
  }
}

/** Three letters as one number, so a reordering shows as a different value. */
function letters(keys: readonly string[]): number {
  let total = 0;
  for (let i = 0; i < keys.length; i++) {
    total = total * 128 + (keys[i] ?? "").charCodeAt(0);
  }
  return total;
}

/**
 * Under test: the derived field is written **first**, which is what an
 * inherited-fields-first layout gets wrong.
 */
export function derivedFieldWrittenFirst(n: number): number {
  const e: Extended = { c: n, a: 1, b: 2 };
  return letters(Object.keys(e));
}

/**
 * A class, where base-first is already the layout and is also the order the
 * constructor writes in. This one is unaffected by the question and is here to
 * say so.
 */
export function throughAClass(n: number): number {
  return letters(Object.keys(new ClassDerived(n)));
}

/** Control: a plain literal with no inheritance anywhere near it. */
export function aPlainLiteral(n: number): number {
  const o = { z: n, y: 1, x: 2 };
  return letters(Object.keys(o));
}

/** Control: the values are still readable, so the layout is not merely ordered. */
export function theValuesSurvive(n: number): number {
  const e: Extended = { c: n, a: 1, b: 2 };
  return e.c * 100 + e.a * 10 + e.b;
}
