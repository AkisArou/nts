/*---
description: Four Map key/value writers feed wider reader instantiations while preserving payloads, key identity and stored undefined.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-map-set, ts-unions, ts-unknown, ts-object-type, ts-generics]
---*/
// put<K,V> fills string/number, number/string, object/object and optional-value maps; get<K,V> widens both key
// and value types without changing node reads.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function put<K, V>(items: Map<K, V>, key: K, value: V): void { items.set(key, value); }
function get<K, V>(items: Map<K, V>, key: K): V | undefined { return items.get(key); }
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const key: ContainerItem = { id: n + 1 };
  const numbers = new Map<string, number>(), strings = new Map<number, string>();
  const objects = new Map<ContainerItem, ContainerItem>(), optional = new Map<string, number | undefined>();
  put<string, number>(numbers, "value", n); put<number, string>(strings, n, text);
  put<ContainerItem, ContainerItem>(objects, key, item); put<string, number | undefined>(optional, "value", undefined);
  same(get<string | number, number | string>(numbers, "value"), n);
  same(get<number | string, string | undefined>(strings, n), text);
  same(get<object, ContainerItem | undefined>(objects, key), item);
  same(get<unknown, unknown>(optional, "value"), undefined); same(get<unknown, unknown>(optional, "missing"), undefined);
  assert.sameValue(optional.has("value"), true); assert.sameValue(optional.has("missing"), false);
  assert.sameValue(objects.has(key), true); assert.sameValue(objects.has({ id: n + 1 }), false);
  assert.sameValue(numbers.size, 1); assert.sameValue(strings.size, 1);
  assert.sameValue(objects.size, 1); assert.sameValue(optional.size, 1);
}
