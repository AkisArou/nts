/*---
description: Control for containers-array-map-specializations; spell out each generic specialization as a separate function.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-unknown, ts-arrow-functions, ts-function-types, ts-closures]
---*/
// Use separate non-generic functions for each type argument; the values, container operations and assertions
// are unchanged.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function transformNumberItem(items: number[], apply: (value: number) => ContainerItem): ContainerItem[] {
  return items.map(apply);
}
function transformStringNumber(items: string[], apply: (value: string) => number): number[] { return items.map(apply); }
function transformItemString(items: ContainerItem[], apply: (value: ContainerItem) => string): string[] {
  return items.map(apply);
}
function transformUndefinedUnknown(items: undefined[], apply: (value: undefined) => unknown): unknown[] {
  return items.map(apply);
}
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const os = transformNumberItem([n], value => { same(value, n); return item; });
  const ns = transformStringNumber([text], value => { same(value, text); return n; });
  const ss = transformItemString([item], value => { same(value, item); return text; });
  const us = transformUndefinedUnknown([undefined], value => { same(value, undefined); return undefined; });
  same(os[0], item); same(ns[0], n); same(ss[0], text); same(us[0], undefined);
  assert.sameValue(os.length, 1); assert.sameValue(ns.length, 1); assert.sameValue(ss.length, 1); assert.sameValue(us.length, 1);
}
