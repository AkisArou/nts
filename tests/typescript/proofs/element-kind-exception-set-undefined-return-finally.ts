/*---
description: A finally block adds undefined before a pending return completes.
features: [ts-proof-element-kind, ts-route-exception, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-null-undefined, ts-errors]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: return unwinds through finally, which conditionally inserts undefined before the caller continues.
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
function finish(items: Set<number | undefined>, n: number): number {
  try { return n > 0 ? 7 : 3; }
  finally { if (n > 0) items.add(undefined); }
}
function observe(n: number): Set<number | undefined> {
  const items = new Set<number | undefined>([1, 2]);
  assert.sameValue(finish(items, n), n > 0 ? 7 : 3);
  return items;
}
for (const n of [-1, 0, 1, 3, 7]) check(observe(n), n > 0);
