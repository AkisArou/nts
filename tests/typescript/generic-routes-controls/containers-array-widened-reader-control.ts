/*---
description: Control for containers-array-widened-reader; spell out each generic specialization as a separate function.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-unions, ts-unknown]
---*/
// Use separate non-generic functions for each type argument; the values, container operations and assertions
// are unchanged.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function putNumber(items: number[], value: number): void { items.push(value); }
function putString(items: string[], value: string): void { items.push(value); }
function putItem(items: ContainerItem[], value: ContainerItem): void { items.push(value); }
function putOptional(items: (number | undefined)[], value: number | undefined): void { items.push(value); }
function readNumberString(items: (number | string)[], index: number): number | string { return items[index]; }
function readStringOptional(items: (string | undefined)[], index: number): string | undefined { return items[index]; }
function readItemOptional(items: (ContainerItem | undefined)[], index: number): ContainerItem | undefined {
  return items[index];
}
function readUnknown(items: unknown[], index: number): unknown { return items[index]; }
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const numbers: number[] = [], strings: string[] = [], objects: ContainerItem[] = [];
  const optional: (number | undefined)[] = [];
  putNumber(numbers, n); putString(strings, text); putItem(objects, item);
  putOptional(optional, n); putOptional(optional, undefined);
  same(readNumberString(numbers, 0), n); same(readStringOptional(strings, 0), text);
  same(readItemOptional(objects, 0), item);
  same(readUnknown(optional, 0), n); same(readUnknown(optional, 1), undefined);
  assert.sameValue(numbers.length, 1); assert.sameValue(strings.length, 1);
  assert.sameValue(objects.length, 1); assert.sameValue(optional.length, 2);
}
