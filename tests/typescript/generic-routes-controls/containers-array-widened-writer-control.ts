/*---
description: Control for containers-array-widened-writer; spell out each generic specialization as a separate function.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-unions, ts-unknown, ts-unsound-generic-widening]
---*/
// Use separate non-generic functions for each type argument; the values, container operations and assertions
// are unchanged.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function putUnknown(items: unknown[], value: unknown): void { items[0] = value; }
function putNumberString(items: (number | string)[], value: number | string): void { items[0] = value; }
function putItemOptional(items: (ContainerItem | undefined)[], value: ContainerItem | undefined): void {
  items[0] = value;
}
function readNumber(items: number[]): number { return items[0]; }
function readString(items: string[]): string { return items[0]; }
function readItem(items: ContainerItem[]): ContainerItem { return items[0]; }
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const numbers: number[] = [n], strings: string[] = [text], objects: ContainerItem[] = [item];
  same(readNumber(numbers), n); same(readString(strings), text); same(readItem(objects), item);
  putUnknown(numbers, item); putNumberString(strings, n); putItemOptional(objects, undefined);
  same(readNumber(numbers), item); same(readString(strings), n); same(readItem(objects), undefined);
  assert.sameValue(numbers.length, 1); assert.sameValue(strings.length, 1); assert.sameValue(objects.length, 1);
}
