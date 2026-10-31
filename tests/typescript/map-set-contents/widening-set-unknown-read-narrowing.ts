/*---
description: Unknown Set elements retain their type before genuine numeric or string narrowing.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-unions, ts-narrowing, ts-numbers, ts-strings]
---*/
// Write/read route: an unknown-valued Set write is enumerated and narrowed with typeof; node keeps the exact contents and order.
function store(set: Set<unknown>, value: unknown): void { set.add(value); }
function check(input: number | string): void {
  const set = new Set<unknown>();
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
