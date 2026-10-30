/*---
description: A nested callee stores undefined through a wider Set view before the original numeric iterator reads it.
features: [ts-proof-element-kind, ts-route-call, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-null-undefined, ts-closures]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the original Set<number> is passed normally to Set<unknown>, then a nested function inserts undefined.
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
function insert(items: Set<unknown>, n: number): void {
  function write(): void { items.add(undefined); }
  if (n > 0) write();
}
function observe(n: number): Set<number> {
  const items = new Set<number>([1, 2]);
  insert(items, n);
  return items;
}
for (const n of [-1, 0, 1, 3, 7]) check(observe(n), n > 0);
