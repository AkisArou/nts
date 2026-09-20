// The order own properties are enumerated in.
//
// **Array indices first, ascending numerically; then the rest in insertion
// order.** That is `OrdinaryOwnPropertyKeys`, and this compiler gave the
// layout's order for everything — which is insertion order and nothing else —
// so
//
//     Object.keys({ b: 1, a: 2, 2: 3, 1: 4 })
//
// answered `["b", "a", "2", "1"]` where node answers `["1", "2", "b", "a"]`.
//
// A **wrong answer rather than a refusal**, in a builtin that ordinary code
// calls, and no corpus file reported it: the census ranks refusals, and this
// compiled and ran and produced a different list. It was found by a probe
// sweep against node, which is the only instrument that can see it.
//
// # Four consumers were wrong together
//
// `Object.keys`, `Object.entries`, `Object.values`, and `for...in` — the last
// through `decide_object_keys`, so it was three call sites and one rule.
// `property_order` returns the **permutation** rather than a name list for
// exactly that reason: a column reads its value from the layout's slot and
// writes it at the enumeration position, and those are two different numbers.
// `entriesAreReordered` is the arm that fails if they are conflated — the
// names would come out right and the values would be paired with the wrong
// ones.
//
// # What an array index is
//
// The specification's `CanonicalNumericIndexString`, restricted to integers
// below 2^32 - 1 — which is exactly "the decimal spelling round-trips".
// `"01"`, `"1.0"` and `"-1"` are ordinary string keys and stay where they were
// written, and `notAnIndex` is the arm that says so. One test rather than a
// list of special cases, so there is no second rule to keep in step.
//
// **The comment on `decide_object_keys` named this exception without
// implementing it** — "insertion order, which is what `Object.keys` is
// specified to give for string keys *that are not array indices*". A
// precondition stated in prose beside code that does not meet it.

const mixed = { b: 1, a: 2, 2: 3, 1: 4 };

export function keysAreReordered(n: number): string {
  return Object.keys(mixed).join(",") + (n < 1 ? "" : "!");
}

/** The values follow the keys, which is what the permutation is for. */
export function valuesAreReordered(n: number): string {
  return Object.values(mixed).join(",") + (n < 1 ? "" : "!");
}

/**
 * Entries pair a name with a value. Reordering the names without reordering
 * the reads would give the right list of names and the wrong pairing, and only
 * this arm can tell.
 *
 * Written as a `for...of` rather than `.map(...).join(",")` **because the
 * mapped form trips an unrelated reference-counting defect**, which this
 * fixture found by being the first to write it. It is pinned on its own in
 * `examples/a-mapped-tuple-in-a-concatenation` rather than left inside this
 * one, so that a fixture tests one thing and the defect is named after itself.
 */
export function entriesAreReordered(n: number): string {
  let out = "";
  for (const e of Object.entries(mixed)) {
    out = out + e[0] + "=" + e[1].toString() + ";";
  }
  return out + (n < 1 ? "" : "!");
}

export function forInFollowsTheSameOrder(n: number): string {
  let seen = "";
  for (const k in mixed) {
    seen = seen + k;
  }
  return seen + (n < 1 ? "" : "!");
}

/**
 * Keys that **look** numeric and are not: a leading zero, a decimal point, a
 * sign. Each is an ordinary string key and keeps its written position.
 */
const lookalikes = { "01": 1, "1.0": 2, "-1": 3, "10": 4, "2": 5 };

export function notAnIndex(n: number): string {
  return Object.keys(lookalikes).join(",") + (n < 1 ? "" : "!");
}

/**
 * The control: an object with **no** index-like key keeps insertion order,
 * which is what the layout already gave. A change that sorted everything would
 * pass every arm above and lose this one.
 */
const plain = { zebra: 1, apple: 2, mango: 3 };

export function insertionOrderSurvives(n: number): string {
  return Object.keys(plain).join(",") + (n < 1 ? "" : "!");
}

/** And the same for the values, which are read by slot. */
export function plainValues(n: number): string {
  return Object.values(plain).join(",") + (n < 1 ? "" : "!");
}

// # A `#private` field is not a property
//
// It is storage, and `Object.keys(new C())` does not mention it — this listed
// it, which is the same kind of wrong answer as the ordering and was found in
// the same sweep.
//
// **The test is the declaration, not the name.** `#h` and `"#h"` are two
// different members that a layout spells identically, and both
// `class C { "#h" = 1 }` and `const o = { "#h": 1 }` are ordinary enumerable
// properties that worked before this change — so a prefix test would have
// broken two working cases to fix one broken one. That is measured, not
// assumed: `aStringKeyThatLooksPrivate` and `aLiteralKeyThatLooksPrivate` are
// the two arms, and they fail on a prefix test.
//
// `PropertyRecord::declaration` points at the node and a private member names
// itself with a `PRIVATE_IDENTIFIER`. A TypeScript `private` field is a
// different thing entirely — it hides the name from the checker and leaves an
// ordinary enumerable property — and `aTypeScriptPrivateField` says so.

class Hidden {
  #secret = 1;
  shown = 2;

  reveal(): number {
    return this.#secret;
  }
}

export function aPrivateFieldIsNotAKey(n: number): string {
  return Object.keys(new Hidden()).join(",") + (n < 1 ? "" : "!");
}

export function norIsItVisitedByForIn(n: number): string {
  let seen = "";
  for (const k in new Hidden()) {
    seen = seen + k;
  }
  return seen + (n < 1 ? "" : "!");
}

/** The storage is still there and still reachable from inside the class. */
export function theStorageIsStillThere(n: number): number {
  return new Hidden().reveal() + (n < 1 ? 0 : 0);
}

class LooksPrivate {
  "#h" = 1;
  v = 2;
}

export function aStringKeyThatLooksPrivate(n: number): string {
  return Object.keys(new LooksPrivate()).join(",") + (n < 1 ? "" : "!");
}

const literalLooksPrivate = { "#h": 1, a: 2 };

export function aLiteralKeyThatLooksPrivate(n: number): string {
  return Object.keys(literalLooksPrivate).join(",") + (n < 1 ? "" : "!");
}

class TypeScriptPrivate {
  private h = 1;
  v = 2;

  read(): number {
    return this.h;
  }
}

export function aTypeScriptPrivateField(n: number): string {
  return Object.keys(new TypeScriptPrivate()).join(",") + (n < 1 ? "" : "!");
}
