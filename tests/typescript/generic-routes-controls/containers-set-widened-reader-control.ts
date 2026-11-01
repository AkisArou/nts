/*---
description: Control for containers-set-widened-reader; spell out each generic specialization as a separate function.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-map-set, ts-unions, ts-unknown]
---*/
// Use separate non-generic functions for each type argument; the values, container operations and assertions
// are unchanged.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function putNumber(items: Set<number>, value: number): void { items.add(value); }
function putString(items: Set<string>, value: string): void { items.add(value); }
function putItem(items: Set<ContainerItem>, value: ContainerItem): void { items.add(value); }
function putOptional(items: Set<number | undefined>, value: number | undefined): void { items.add(value); }
function snapshotNumberString(items: Set<number | string>): (number | string)[] { return Array.from(items); }
function snapshotStringOptional(items: Set<string | undefined>): (string | undefined)[] { return Array.from(items); }
function snapshotItemOptional(items: Set<ContainerItem | undefined>): (ContainerItem | undefined)[] {
  return Array.from(items);
}
function snapshotUnknown(items: Set<unknown>): unknown[] { return Array.from(items); }
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const numbers = new Set<number>(), strings = new Set<string>(), objects = new Set<ContainerItem>();
  const optional = new Set<number | undefined>();
  putNumber(numbers, n); putNumber(numbers, n); putString(strings, text);
  putItem(objects, item); putOptional(optional, undefined);
  const ns = snapshotNumberString(numbers), ss = snapshotStringOptional(strings);
  const os = snapshotItemOptional(objects), us = snapshotUnknown(optional);
  same(ns[0], Object.is(n, -0) ? 0 : n); same(ss[0], text); same(os[0], item); same(us[0], undefined);
  assert.sameValue(ns.length, 1); assert.sameValue(ss.length, 1); assert.sameValue(os.length, 1); assert.sameValue(us.length, 1);
  assert.sameValue(numbers.size, 1); assert.sameValue(strings.size, 1);
  assert.sameValue(objects.size, 1); assert.sameValue(optional.size, 1);
  assert.sameValue(numbers.has(n), true); assert.sameValue(objects.has(item), true); assert.sameValue(optional.has(undefined), true);
}
