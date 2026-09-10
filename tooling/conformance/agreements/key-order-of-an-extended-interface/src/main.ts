// `Object.keys` on an object typed by an interface that extends another, where
// the literal is written base-fields-first.
//
// JavaScript orders own string keys by **insertion**: `{ a, b, c }` answers
// `a, b, c` whatever its declared type is. A compiled object has no insertion
// order — it has a layout, and `Object.keys` walks the layout's field order.
//
// The layout of `interface Extended extends Base` is **derived-first**, so it is
// `c, a, b`. A literal written `{ c, a, b }` therefore agrees with node by
// coincidence, and one written `{ a, b, c }` does not. This is the second.
//
// # Why it is not fixed by reordering
//
// It was tried. Laying the inherited fields first makes this case agree, makes
// `examples/key-order-through-an-extended-interface` disagree on all 29 of its
// cases, and clears 4 of the 75 structural-cast refusals in the corpus. One
// layout is one order and a literal can be written in any of them, so no
// ordering rule makes both agree.
//
// What would: key order recorded per allocation site rather than read off the
// layout. That is a representation change and it is what this case is waiting
// for — not a field-order preference.
//
// # Its neighbours, which are not this
//
// `examples/object-key-order` and `agreements/integer-like-key-order` are about
// JavaScript's *rule* — integer-like keys ascending before string keys in
// insertion order — which this compiler implements. This one is about there
// being no insertion order to implement it over.

interface Base {
  a: number;
  b: number;
}

interface Extended extends Base {
  c: number;
}

function letters(keys: readonly string[]): number {
  let total = 0;
  for (let i = 0; i < keys.length; i++) {
    total = total * 128 + (keys[i] ?? "").charCodeAt(0);
  }
  return total;
}

/** node: `a, b, c`. Compiled: `c, a, b`, from the layout. */
export function baseFieldsWrittenFirst(): number {
  const e: Extended = { a: 7, b: 1, c: 2 };
  return letters(Object.keys(e));
}

/** The pair, which agrees, and is why this is an ordering and not an absence. */
export function derivedFieldWrittenFirst(): number {
  const e: Extended = { c: 7, a: 1, b: 2 };
  return letters(Object.keys(e));
}

/** Control: no inheritance, so the layout is the literal's own order. */
export function aPlainLiteral(): number {
  const o = { z: 7, y: 1, x: 2 };
  return letters(Object.keys(o));
}
