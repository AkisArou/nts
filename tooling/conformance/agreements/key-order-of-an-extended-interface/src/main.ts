// `Object.keys` on an object typed by an interface that extends another, where
// the literal is written base-fields-first.
//
// JavaScript orders own string keys by **insertion**: `{ a, b, c }` answers
// `a, b, c` whatever its declared type is. A compiled object has no insertion
// order, so this used to be read off the layout -- and a layout is one order per
// *type* where insertion order is a fact about each *object*. Both literals
// below are `Extended`, written the two ways round, and one layout cannot
// answer for both.
//
// **This agreed on 2026-09-23 and the two functions below are why it is kept.**
// `own_names` asks the *value*: `written_as_a_literal` finds the literal behind
// the argument -- the expression itself, or the initialiser of the `const` that
// binds it -- and `as_that_literal_writes_them` orders the names by it. The
// layout is untouched and is still the answer where no literal is in hand.
// Record 0342.
//
// # What the two before it settled
//
// Record 0258 laid inherited fields first so that `Extended` would be a genuine
// prefix of `Base`: four structural-cast sites cleared,
// `examples/key-order-through-an-extended-interface` went from 29 of 29
// agreeing to 0 of 29, reverted. Record 0259 took the order from the program's
// literals instead of the declaration, which fixed every shape the program
// writes *consistently* -- and wrote down that this case was the one it could
// not, because a layout was still being asked a per-object question.
//
// So the header this file carried for two weeks -- "what this is waiting for is
// key order recorded per allocation site, which is a representation change" --
// was right about the answer and wrong about the price. The allocation site is
// the literal, it is in hand at the use, and no representation changed.
//
// # What it does NOT license
//
// It does not free the layout to be inherited-first. The decoupling is partial
// by construction: where no literal is in hand the layout's order is still the
// answer, and those are exactly the cases 0258 measured -- "types the program
// builds through constructors and parameters rather than literals". Flipping
// the layout would move them from right to wrong. `examples/key-order-through-
// an-extended-interface` is the file that fails if anyone tries.
//
// # Its neighbours, which are not this
//
// `examples/object-key-order` and `agreements/integer-like-key-order` are about
// JavaScript's *rule* -- integer-like keys ascending before string keys in
// insertion order -- which this compiler implements, and which is applied after
// this ordering rather than instead of it.

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

/** node: `a, b, c`. Read off the layout this answered `c, a, b`. */
export function baseFieldsWrittenFirst(): number {
  const e: Extended = { a: 7, b: 1, c: 2 };
  return letters(Object.keys(e));
}

/**
 * The pair: the same type written the other way round, which agreed before and
 * still does. It is why this is an ordering and not an absence -- and it is the
 * arm that fails if the answer ever goes back to being one order per type.
 */
export function derivedFieldWrittenFirst(): number {
  const e: Extended = { c: 7, a: 1, b: 2 };
  return letters(Object.keys(e));
}

/** Control: no inheritance, so the layout is the literal's own order. */
export function aPlainLiteral(): number {
  const o = { z: 7, y: 1, x: 2 };
  return letters(Object.keys(o));
}
