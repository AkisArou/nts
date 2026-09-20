// expect: NTS1001 `Object.entries` of unrepresentable type
//
// `Object.entries` and `Object.values` work on an object **literal** and refuse
// on a **class instance**, with uniform field types on both sides:
//
//     const o = { a: 1, b: 2 };     Object.entries(o)        lowers
//     class C { a = 1; b = 2; }     Object.entries(new C())  refused
//
// `Object.keys` lowers for both, which is what makes the split visible: the
// three walk the same own-property list and only two of them need a *value*
// representation. `enumerable_fields` supplies that list and is not the
// obstacle — it is what the key half already uses, including the rule that a
// `#private` member is not a key.
//
// # Zero files in the test262 slice-1 population
//
// Measured before filing rather than after: `entries`, `values` and
// `JSON.stringify` appear in **no** row of the 4,812-file census. Recorded here
// because the boundary is clean and the next person to want it should not have
// to find it again, not because it ranks.
//
// Whether it is worth anything is a question about the *node* profile, which is
// a different corpus and the one the `_value` array family is counted in — 27 of
// 29 sites there, and zero here. A named work item in one corpus can be worth
// nothing in another, and the message is identical in both.
//
// # Controls
//
//     the same call on an object literal      lowers
//     `Object.keys` on the class instance     lowers
//     a `#private` member beside the fields   must stay out of all three

class Holder {
  #hidden = 9;

  first = 1;

  second = 2;

  reach(): number {
    return this.#hidden;
  }
}

/** Under test. */
export function entriesOfAnInstance(n: number): number {
  const pairs = Object.entries(new Holder());
  return pairs.length * 10 + (pairs[0][0] === "first" ? 1 : 0) + (n & 7);
}

/** Control: the key half, which already walks the same list. */
export function keysOfAnInstance(n: number): number {
  const held = new Holder();
  return Object.keys(held).length * 10 + held.reach() + (n & 7);
}

/** Control: the same call on an object literal. */
export function entriesOfALiteral(n: number): number {
  const pairs = Object.entries({ first: 1, second: 2 });
  return pairs.length + (n & 7);
}
