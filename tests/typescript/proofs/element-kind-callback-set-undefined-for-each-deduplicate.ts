/*---
description: Set.forEach receives one present undefined even when a wider callback view adds it twice.
features: [ts-proof-element-kind, ts-route-callback, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-null-undefined, ts-arrow-functions, ts-closures]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the callback on 2 adds undefined twice through Set<unknown>, with no further writes on its new visit.
function check(items: Set<number>, changed: boolean): void {
  const presence: Set<unknown> = items;
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
  assert.sameValue(presence.has(undefined), changed);
  assert.sameValue(items.size, changed ? 3 : 2);
}
function observe(n: number): Set<number> {
  const items = new Set<number>([1, 2]);
  let visits = 0;
  items.forEach((value, duplicate, owner) => {
    assert.sameValue(duplicate, value);
    assert.sameValue(owner, items);
    assert.sameValue(value, visits < 2 ? visits + 1 : undefined);
    visits++;
    if (value === 2 && n > 0) {
      const writer: Set<unknown> = owner;
      writer.add(undefined).add(undefined);
    }
  });
  assert.sameValue(visits, n > 0 ? 3 : 2);
  return items;
}
for (const n of [-1, 0, 1, 3, 7]) check(observe(n), n > 0);
