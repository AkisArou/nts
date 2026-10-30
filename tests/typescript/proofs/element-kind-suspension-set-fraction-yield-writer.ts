/*---
description: A Set receives a fraction while its reading generator is suspended.
features: [ts-proof-element-kind, ts-route-suspension, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-generators]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the caller inserts a fraction between the generator's two next calls.
function read(items: Set<number>): number {
  let last = 0;
  for (const value of items) last = value;
  return last;
}

function* pause(items: Set<number>): Generator<number, number, void> {
  yield read(items);
  return read(items);
}
function observe(n: number): number {
  const items = new Set<number>([1, 2]);
  const steps = pause(items), before = steps.next();
  assert.sameValue(before.done, false);
  assert.sameValue(before.value, 2);
  if (n > 0) items.add(n + 0.5);
  const after = steps.next();
  assert.sameValue(after.done, true);
  return after.value;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result, n > 0 ? n + 0.5 : 2);
}
