/*---
description: Control for containers-map-widened-reader; spell out each generic specialization as a separate function.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-map-set, ts-unions, ts-unknown, ts-object-type]
---*/
// Use separate non-generic functions for each type argument; the values, container operations and assertions
// are unchanged.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function putNumber(items: Map<string, number>, key: string, value: number): void { items.set(key, value); }
function putString(items: Map<number, string>, key: number, value: string): void { items.set(key, value); }
function putItem(items: Map<ContainerItem, ContainerItem>, key: ContainerItem, value: ContainerItem): void {
  items.set(key, value);
}
function putOptional(items: Map<string, number | undefined>, key: string, value: number | undefined): void {
  items.set(key, value);
}
function getNumberString(items: Map<string | number, number | string>, key: string | number): number | string | undefined {
  return items.get(key);
}
function getStringOptional(items: Map<number | string, string | undefined>, key: number | string): string | undefined {
  return items.get(key);
}
function getItemOptional(items: Map<object, ContainerItem | undefined>, key: object): ContainerItem | undefined {
  return items.get(key);
}
function getUnknown(items: Map<unknown, unknown>, key: unknown): unknown { return items.get(key); }
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const key: ContainerItem = { id: n + 1 };
  const numbers = new Map<string, number>(), strings = new Map<number, string>();
  const objects = new Map<ContainerItem, ContainerItem>(), optional = new Map<string, number | undefined>();
  putNumber(numbers, "value", n); putString(strings, n, text);
  putItem(objects, key, item); putOptional(optional, "value", undefined);
  same(getNumberString(numbers, "value"), n);
  same(getStringOptional(strings, n), text);
  same(getItemOptional(objects, key), item);
  same(getUnknown(optional, "value"), undefined); same(getUnknown(optional, "missing"), undefined);
  assert.sameValue(optional.has("value"), true); assert.sameValue(optional.has("missing"), false);
  assert.sameValue(objects.has(key), true); assert.sameValue(objects.has({ id: n + 1 }), false);
  assert.sameValue(numbers.size, 1); assert.sameValue(strings.size, 1);
  assert.sameValue(objects.size, 1); assert.sameValue(optional.size, 1);
}
