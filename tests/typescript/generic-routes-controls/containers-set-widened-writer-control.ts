/*---
description: Control for containers-set-widened-writer; spell out each generic specialization as a separate function.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-map-set, ts-unions, ts-unknown, ts-unsound-generic-widening]
---*/
// Use separate non-generic functions for each type argument; the values, container operations and assertions
// are unchanged.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function putUnknown(items: Set<unknown>, value: unknown): void { items.add(value); }
function putNumberString(items: Set<number | string>, value: number | string): void { items.add(value); }
function putItemOptional(items: Set<ContainerItem | undefined>, value: ContainerItem | undefined): void {
  items.add(value);
}
function snapshotNumber(items: Set<number>): number[] { return Array.from(items); }
function snapshotString(items: Set<string>): string[] { return Array.from(items); }
function snapshotItem(items: Set<ContainerItem>): ContainerItem[] { return Array.from(items); }
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const numbers = new Set<number>([n]), strings = new Set<string>([text]), objects = new Set<ContainerItem>([item]);
  putUnknown(numbers, item); putNumberString(strings, n); putItemOptional(objects, undefined);
  const ns = snapshotNumber(numbers), ss = snapshotString(strings), os = snapshotItem(objects);
  same(ns[0], Object.is(n, -0) ? 0 : n); same(ns[1], item);
  same(ss[0], text); same(ss[1], Object.is(n, -0) ? 0 : n); same(os[0], item); same(os[1], undefined);
  assert.sameValue(ns.length, 2); assert.sameValue(ss.length, 2); assert.sameValue(os.length, 2);
  assert.sameValue(numbers.size, 2); assert.sameValue(strings.size, 2); assert.sameValue(objects.size, 2);
  assert.sameValue(numbers.has(ns[1]), true); assert.sameValue(strings.has(ss[1]), true); assert.sameValue(objects.has(os[1]), true);
}
