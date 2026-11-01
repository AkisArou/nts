/*---
description: Wider Map writers change values and add a different key kind, then narrow generic readers preserve the stored runtime values.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-map-set, ts-unions, ts-unknown, ts-unsound-generic-widening, ts-generics]
---*/
// put<K,V> uses unknown and unions beside get<K,V> at the original concrete types; node keeps
// object/number/undefined values and distinct numeric and string keys.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function put<K, V>(items: Map<K, V>, key: K, value: V): void { items.set(key, value); }
function get<K, V>(items: Map<K, V>, key: K): V | undefined { return items.get(key); }
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const key: ContainerItem = { id: n + 1 };
  const numbers = new Map<string, number>([["value", n]]), strings = new Map<number, string>([[1, text]]);
  const objects = new Map<ContainerItem, ContainerItem>([[key, item]]);
  same(get<string, number>(numbers, "value"), n); same(get<number, string>(strings, 1), text);
  same(get<ContainerItem, ContainerItem>(objects, key), item);
  put<string, unknown>(numbers, "value", item);
  put<number | string, number | string>(strings, 1, n); put<number | string, number | string>(strings, "1", text);
  put<ContainerItem, ContainerItem | undefined>(objects, key, undefined);
  same(get<string, number>(numbers, "value"), item); same(get<number, string>(strings, 1), n);
  same(get<number | string, number | string>(strings, "1"), text);
  same(get<ContainerItem, ContainerItem>(objects, key), undefined);
  assert.sameValue(objects.has(key), true); assert.sameValue(objects.has({ id: n + 1 }), false);
  assert.sameValue(numbers.size, 1); assert.sameValue(strings.size, 2); assert.sameValue(objects.size, 1);
}
