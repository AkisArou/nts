/*---
description: Four Set writer specializations feed wider generic iteration copies while preserving node zero normalization, NaN, references and undefined.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-map-set, ts-unions, ts-unknown, ts-generics]
---*/
// put<T> fills concrete sets and snapshot<T> reads wider unions and unknown; node preserves insertion values
// except its required normalization of -0 to +0.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function put<T>(items: Set<T>, value: T): void { items.add(value); }
function snapshot<T>(items: Set<T>): T[] { return Array.from(items); }
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const numbers = new Set<number>(), strings = new Set<string>(), objects = new Set<ContainerItem>();
  const optional = new Set<number | undefined>();
  put<number>(numbers, n); put<number>(numbers, n); put<string>(strings, text);
  put<ContainerItem>(objects, item); put<number | undefined>(optional, undefined);
  const ns = snapshot<number | string>(numbers), ss = snapshot<string | undefined>(strings);
  const os = snapshot<ContainerItem | undefined>(objects), us = snapshot<unknown>(optional);
  same(ns[0], Object.is(n, -0) ? 0 : n); same(ss[0], text); same(os[0], item); same(us[0], undefined);
  assert.sameValue(ns.length, 1); assert.sameValue(ss.length, 1); assert.sameValue(os.length, 1); assert.sameValue(us.length, 1);
  assert.sameValue(numbers.size, 1); assert.sameValue(strings.size, 1);
  assert.sameValue(objects.size, 1); assert.sameValue(optional.size, 1);
  assert.sameValue(numbers.has(n), true); assert.sameValue(objects.has(item), true); assert.sameValue(optional.has(undefined), true);
}
