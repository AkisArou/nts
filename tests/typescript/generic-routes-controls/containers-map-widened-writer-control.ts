/*---
description: Control for containers-map-widened-writer; spell out each generic specialization as a separate function.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-map-set, ts-unions, ts-unknown, ts-unsound-generic-widening]
---*/
// Use separate non-generic functions for each type argument; the values, container operations and assertions
// are unchanged.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function putUnknown(items: Map<string, unknown>, key: string, value: unknown): void { items.set(key, value); }
function putMixed(items: Map<number | string, number | string>, key: number | string, value: number | string): void {
  items.set(key, value);
}
function putOptional(items: Map<ContainerItem, ContainerItem | undefined>, key: ContainerItem, value: ContainerItem | undefined): void {
  items.set(key, value);
}
function getNumber(items: Map<string, number>, key: string): number | undefined { return items.get(key); }
function getString(items: Map<number, string>, key: number): string | undefined { return items.get(key); }
function getItem(items: Map<ContainerItem, ContainerItem>, key: ContainerItem): ContainerItem | undefined {
  return items.get(key);
}
function getMixed(items: Map<number | string, number | string>, key: number | string): number | string | undefined {
  return items.get(key);
}
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const key: ContainerItem = { id: n + 1 };
  const numbers = new Map<string, number>([["value", n]]), strings = new Map<number, string>([[1, text]]);
  const objects = new Map<ContainerItem, ContainerItem>([[key, item]]);
  same(getNumber(numbers, "value"), n); same(getString(strings, 1), text);
  same(getItem(objects, key), item);
  putUnknown(numbers, "value", item);
  putMixed(strings, 1, n); putMixed(strings, "1", text);
  putOptional(objects, key, undefined);
  same(getNumber(numbers, "value"), item); same(getString(strings, 1), n);
  same(getMixed(strings, "1"), text);
  same(getItem(objects, key), undefined);
  assert.sameValue(objects.has(key), true); assert.sameValue(objects.has({ id: n + 1 }), false);
  assert.sameValue(numbers.size, 1); assert.sameValue(strings.size, 2); assert.sameValue(objects.size, 1);
}
