/*---
description: Control for widening-set-unknown-read-narrowing; all collection accesses use one declared type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-unions, ts-narrowing, ts-numbers, ts-strings]
---*/
// Paired case: ../map-set-contents/widening-set-unknown-read-narrowing.ts.
// Only collection/generic declarations are unified; writes, reads and assertions are unchanged.
function store(set: Set<number | string>, value: number | string): void { set.add(value); }
function check(input: number | string): void {
  const set = new Set<number | string>();
  store(set, input);
  let visits = 0;
  for (const value of set) {
    visits++;
    const expected = input === 0 ? 0 : input;
    assert.sameValue(value, expected);
    assert.sameValue(typeof value, typeof input);
    if (typeof value === "number") {
      if (typeof input !== "number") throw new Test262Error("wrong numeric branch");
      assert.sameValue(value + 0.5, input + 0.5);
    } else if (typeof value === "string") {
      if (typeof input !== "string") throw new Test262Error("wrong string branch");
      assert.sameValue(value.slice(1), input.slice(1));
    } else throw new Test262Error("unexpected stored type");
    assert.sameValue(set.has(value), true);
  }
  assert.sameValue(visits, 1);
  assert.sameValue(set.size, 1);
}
const inputs: (number | string)[] = [-0, NaN, 2147483649, "7", "", "wide"];
for (const input of inputs) check(input);
