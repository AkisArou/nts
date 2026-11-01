/*---
description: Control for containers-array-filter-specializations; spell out each generic specialization as a separate function.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-unions, ts-unknown, ts-arrow-functions, ts-function-types, ts-closures]
---*/
// Use separate non-generic functions for each type argument; the values, container operations and assertions
// are unchanged.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function selectNumber(items: number[], keep: (value: number) => boolean): number[] { return items.filter(keep); }
function selectString(items: string[], keep: (value: string) => boolean): string[] { return items.filter(keep); }
function selectItem(items: ContainerItem[], keep: (value: ContainerItem) => boolean): ContainerItem[] {
  return items.filter(keep);
}
function selectOptional(items: (number | undefined)[], keep: (value: number | undefined) => boolean): (number | undefined)[] {
  return items.filter(keep);
}
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const other: ContainerItem = { id: n }, seen: unknown[] = [];
  const ns = selectNumber([n, 99], value => { seen.push(value); return !Object.is(value, 99); });
  const ss = selectString(["drop", text], value => { seen.push(value); return value === text; });
  const os = selectItem([other, item], value => { seen.push(value); return value === item; });
  const us = selectOptional([n, undefined], value => { seen.push(value); return value === undefined; });
  same(ns[0], n); same(ss[0], text); same(os[0], item); same(us[0], undefined);
  assert.sameValue(ns.length, 1); assert.sameValue(ss.length, 1); assert.sameValue(os.length, 1); assert.sameValue(us.length, 1);
  const expected: unknown[] = [n, 99, "drop", text, other, item, n, undefined];
  assert.sameValue(seen.length, expected.length);
  for (let i = 0; i < expected.length; i++) same(seen[i], expected[i]);
}
