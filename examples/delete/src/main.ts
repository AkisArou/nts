// `delete o.x`.
//
// TypeScript permits it only where `x` is optional — `TS2790: The operand of a
// 'delete' operator must be optional` — so the property being deleted always
// holds `T | undefined` and always has a slot with a tag in it. Deleting it is
// writing the `undefined` tag, and that is the whole implementation.
//
// The reason that is *sound* rather than merely convenient is worth stating,
// because it is a claim about four other features.
//
// JavaScript distinguishes a deleted property from one set to `undefined`:
// `"x" in o` is false after the first and true after the second, and
// `Object.keys` differs the same way. This representation cannot tell them
// apart — an optional slot is zeroed at allocation and zero *is* the
// `undefined` tag.
//
// So the conflation would be a wrong answer, except that every operator which
// could observe it already refuses on an optional property: `in` names it,
// `Object.keys` and `Object.hasOwn` name it, and `for...in` is refused
// outright. Each of those was argued on its own terms, and together they are
// what makes this one correct. If any is ever implemented for an optional
// property, this becomes wrong on the same day — which is why they all refuse
// by naming the *property* rather than the feature.

interface Bag {
  keep: number;
  maybe?: number;
}

// Deleted, and read back through the test that proves it is gone.
export function deletesAndReads(n: number): number {
  const bag: Bag = { keep: n, maybe: n * 2 };
  const before = bag.maybe === undefined ? 1 : 2;
  delete bag.maybe;
  const after = bag.maybe === undefined ? 10 : 20;
  return before + after;
}

// The expression's value. `delete` evaluates to `true` for a property that was
// there and `true` for one that was not: in a strict-mode program every
// deletable property is configurable, and TypeScript refused the rest.
export function itsResult(n: number): number {
  const bag: Bag = { keep: n, maybe: n };
  const first = delete bag.maybe ? 100 : 200;
  const second = delete bag.maybe ? 1000 : 2000;
  return first + second + n * 0;
}

// Deleting one that was never supplied. The slot is already the `undefined`
// tag, so the store writes what is there — and node agrees, which is the point
// of running it rather than reasoning about it.
export function deletesAnAbsentOne(n: number): number {
  const bag: Bag = { keep: n };
  delete bag.maybe;
  return bag.maybe === undefined ? 1 : 2;
}

// The remaining property is untouched. A store to one slot is a store to one
// slot, and this says so rather than assuming it.
export function leavesTheRest(n: number): number {
  const bag: Bag = { keep: n, maybe: 7 };
  delete bag.maybe;
  return bag.keep;
}

// On a class field rather than an interface, so the layout comes from a
// declaration with a constructor rather than from a literal.
class Held {
  always: number;
  sometimes?: number;
  constructor(always: number, sometimes: number) {
    this.always = always;
    this.sometimes = sometimes;
  }
}

export function onAClassField(n: number): number {
  const held = new Held(n, n * 3);
  const before = held.sometimes === undefined ? 1 : 2;
  delete held.sometimes;
  return before * 10 + (held.sometimes === undefined ? 1 : 2);
}

// Through the optional family, which is what reads a deleted property in real
// code: `??` supplies the fallback and `?.` short-circuits.
export function throughNullish(n: number): number {
  const bag: Bag = { keep: n, maybe: n };
  const before = bag.maybe ?? -1;
  delete bag.maybe;
  const after = bag.maybe ?? -1;
  return before * 1000 + after;
}

// Deleted inside a branch, so the slot's contents differ by path and the
// following read is a genuine join rather than a constant.
export function deletedOnOnePath(n: number): number {
  const bag: Bag = { keep: n, maybe: n };
  if (n > 0) {
    delete bag.maybe;
  }
  return bag.maybe === undefined ? 1 : 2;
}

// Two objects of the same type, one deleted from. The layout is shared and the
// values are not.
export function twoObjects(n: number): number {
  const left: Bag = { keep: n, maybe: n };
  const right: Bag = { keep: n, maybe: n };
  delete left.maybe;
  return (left.maybe === undefined ? 1 : 0) + (right.maybe === undefined ? 10 : 20);
}
