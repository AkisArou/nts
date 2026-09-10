// The layout's field order is the order the program's literals write, where they
// agree.
//
// `Object.keys` walks the layout's field list, because a compiled object has no
// insertion order, and JavaScript orders own string keys by **insertion**. One
// layout is one order, so the two can only agree when the layout *is* the order
// the literals are written in.
//
// The checker's order is not that. For `interface Extended extends Base { c }`
// it puts the derived member first, so a program that writes `{ a, b, c }`
// everywhere was laid out `c, a, b` and answered `c, a, b`.
//
// # This is the second attempt and the first one is why the fixture is shaped
// this way
//
// Laying *inherited* fields first was tried, measured and reverted (record
// 0258): it clears 4 of the corpus's structural-cast refusals and takes
// `examples/key-order-through-an-extended-interface` from 29 of 29 agreeing
// with node to 0 of 29. Both attempts are ordering rules, and the difference is
// that this one takes its order from the program rather than from the
// declaration — so it is right for whichever way the program writes, and the
// other was right for one of them.
//
// It gets the prefix property for free where the program happens to write
// base-first — **and measured across `runtime/node` and `runtime/web-platform`
// that is once.** 75 structural-cast sites before any ordering change, 71 under
// inherited-fields-first, 74 under this. So the sentence that belongs here is
// not "it clears them anyway": it is that key order is what this buys, the
// prefix property is a side effect worth one site, and the 4 that inherited-first
// cleared are types the program builds through constructors and parameters
// rather than literals, which an order taken from literals cannot see.
//
// # And where the program disagrees with itself there is no answer
//
// A file that writes one type `{ a, b, c }` in one function and `{ c, a, b }` in
// another has no single layout that satisfies both. Those types are left in the
// checker's order and the divergence is
// `tooling/conformance/agreements/key-order-of-an-extended-interface`, which
// runs and disagrees on purpose. That is a fact about JavaScript rather than
// about this compiler: insertion order is per *object*, and a layout is per
// type.
//
// The information was never lost, which is what made this cheap. The JVM lane
// read its own bytecode and found the field sets at an allocation site already
// emitted in source order — `{ a: 7, b: 1, c: 2 }` produces sets at indices
// 1, 2, 0 — so the order is in the IR today and this only has to take it before
// the layout is decided rather than after.

interface Base {
  a: number;
  b: number;
}

interface Extended extends Base {
  c: number;
}

interface Unrelated {
  x: number;
  y: number;
  z: number;
}

function letters(keys: readonly string[]): number {
  let total = 0;
  for (let i = 0; i < keys.length; i++) {
    total = total * 128 + (keys[i] ?? "").charCodeAt(0);
  }
  return total;
}

/**
 * Under test: written base-first, which is **not** the order the checker gives
 * an extended interface. Before this, `c, a, b`; node says `a, b, c`.
 */
export function extendedWrittenBaseFirst(n: number): number {
  const e: Extended = { a: n, b: 1, c: 2 };
  return letters(Object.keys(e));
}

/** The same type written the same way elsewhere, so the program agrees. */
export function theSameTypeAgain(n: number): number {
  const e: Extended = { a: 1, b: n, c: 3 };
  return letters(Object.keys(e)) + e.c;
}

/**
 * Control: a type with no `extends`, where the checker's order and the written
 * order already coincided. It must not move.
 */
export function unrelatedIsUnchanged(n: number): number {
  const u: Unrelated = { x: n, y: 1, z: 2 };
  return letters(Object.keys(u));
}

/** Control: written in a scrambled order, which is still the program's order. */
export function writtenScrambled(n: number): number {
  const u = { z: n, x: 1, y: 2 };
  return letters(Object.keys(u));
}

/** Control: the values still read back, so the reorder moved names and slots together. */
export function theValuesFollowTheirNames(n: number): number {
  const e: Extended = { a: n, b: 20, c: 300 };
  return e.a * 10000 + e.b * 100 + e.c;
}

// A `JSON.stringify` case belonged here — it walks the same list, so it is the
// same question — and is not, because `JSON.stringify` in compiled user code is
// refused: `a global member with no definition here`. The shipped serializer in
// `runtime/web-platform` is on the compiled axis and this global is not wired to
// it. Left as a note rather than a refused case, so this file stays off
// `tooling/gate/example-refusals`.
