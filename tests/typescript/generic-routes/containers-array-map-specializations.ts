/*---
description: One generic map changes between numeric, string, object and undefined representations while checking callback inputs and exact outputs.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-unknown, ts-arrow-functions, ts-function-types, ts-closures, ts-generics]
---*/
// transform<T,U> maps number to object, string to number, object to string and undefined to unknown; node
// preserves each checked callback input and result.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function transform<T, U>(items: T[], apply: (value: T) => U): U[] { return items.map(apply); }
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const os = transform<number, ContainerItem>([n], value => { same(value, n); return item; });
  const ns = transform<string, number>([text], value => { same(value, text); return n; });
  const ss = transform<ContainerItem, string>([item], value => { same(value, item); return text; });
  const us = transform<undefined, unknown>([undefined], value => { same(value, undefined); return undefined; });
  same(os[0], item); same(ns[0], n); same(ss[0], text); same(us[0], undefined);
  assert.sameValue(os.length, 1); assert.sameValue(ns.length, 1); assert.sameValue(ss.length, 1); assert.sameValue(us.length, 1);
}
