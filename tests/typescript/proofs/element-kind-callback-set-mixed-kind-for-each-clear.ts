/*---
description: A wider callback view clears a numeric Set and appends a string that the same forEach must visit.
features: [ts-proof-element-kind, ts-route-callback, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-strings, ts-arrow-functions, ts-closures, ts-typeof-operator]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the numeric callback owner widens normally to Set<unknown>, then receives a string after clear.
function read(items: Set<number>): unknown {
  let last: unknown = 0;
  for (const value of items) last = value;
  return last;
}
function observe(n: number): unknown {
  const items = new Set<number>([1, 2]);
  let visits = 0;
  items.forEach((value, duplicate, owner) => {
    assert.sameValue(duplicate, value);
    assert.sameValue(owner, items);
    assert.sameValue(value, visits === 0 ? 1 : n > 0 ? "item:" + n : 2);
    visits++;
    if (value === 1 && n > 0) {
      owner.clear();
      const writer: Set<unknown> = owner;
      writer.add("item:" + n);
    }
  });
  assert.sameValue(visits, 2);
  assert.sameValue(items.size, n > 0 ? 1 : 2);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(typeof result, n > 0 ? "string" : "number");
  assert.sameValue(result, n > 0 ? "item:" + n : 2);
}
