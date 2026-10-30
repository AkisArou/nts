/*---
description: A second do-while iteration stores undefined as a present Set element.
features: [ts-proof-element-kind, ts-route-loop, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-null-undefined]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: only the second body visit adds undefined, so zero/one limits remain controls.
function check(items: Set<number | undefined>, changed: boolean): void {
  const iterator = items.values();
  const first = iterator.next(), second = iterator.next(), third = iterator.next();
  assert.sameValue(first.done, false);
  assert.sameValue(first.value, 1);
  assert.sameValue(second.done, false);
  assert.sameValue(second.value, 2);
  assert.sameValue(third.done, !changed);
  assert.sameValue(third.value, undefined);
  const end = iterator.next();
  assert.sameValue(end.done, true);
  assert.sameValue(end.value, undefined);
  assert.sameValue(items.has(undefined), changed);
  assert.sameValue(items.size, changed ? 3 : 2);
}
function observe(turns: number): Set<number | undefined> {
  const items = new Set<number | undefined>([1, 2]);
  let step = 0;
  do {
    if (step === 1) items.add(undefined);
    step++;
  } while (step < turns);
  return items;
}
for (const n of [0, 1, 2, 3, 5]) check(observe(n), n >= 2);
