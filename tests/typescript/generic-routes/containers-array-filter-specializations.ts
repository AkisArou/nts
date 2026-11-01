/*---
description: One generic filter preserves every predicate input and selected result across number, string, object and optional-number instantiations.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-unions, ts-unknown, ts-arrow-functions, ts-function-types, ts-closures, ts-generics]
---*/
// select<T> filters number, string, object and optional-number arrays; node preserves every logged predicate
// input and selected value in order.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function select<T>(items: T[], keep: (value: T) => boolean): T[] { return items.filter(keep); }
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const other: ContainerItem = { id: n }, seen: unknown[] = [];
  const ns = select<number>([n, 99], value => { seen.push(value); return !Object.is(value, 99); });
  const ss = select<string>(["drop", text], value => { seen.push(value); return value === text; });
  const os = select<ContainerItem>([other, item], value => { seen.push(value); return value === item; });
  const us = select<number | undefined>([n, undefined], value => { seen.push(value); return value === undefined; });
  same(ns[0], n); same(ss[0], text); same(os[0], item); same(us[0], undefined);
  assert.sameValue(ns.length, 1); assert.sameValue(ss.length, 1); assert.sameValue(os.length, 1); assert.sameValue(us.length, 1);
  const expected: unknown[] = [n, 99, "drop", text, other, item, n, undefined];
  assert.sameValue(seen.length, expected.length);
  for (let i = 0; i < expected.length; i++) same(seen[i], expected[i]);
}
