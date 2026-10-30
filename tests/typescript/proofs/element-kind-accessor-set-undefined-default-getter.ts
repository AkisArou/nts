/*---
description: A destructuring default getter stores undefined while a supplied property bypasses the write.
features: [ts-proof-element-kind, ts-route-accessor, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-null-undefined, ts-accessors, ts-objects, ts-closures, ts-destructuring, ts-optional-properties]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: only the missing-property path evaluates the getter and adds undefined.
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
function observe(n: number): Set<number | undefined> {
  const items = new Set<number | undefined>([1, 2]);
  const gate = { get token(): number { items.add(undefined); return 7; } };
  const source: { token?: number } = n > 0 ? {} : { token: 9 };
  const { token = gate.token } = source;
  assert.sameValue(token, n > 0 ? 7 : 9);
  return items;
}
for (const n of [-1, 0, 1, 3, 7]) check(observe(n), n > 0);
