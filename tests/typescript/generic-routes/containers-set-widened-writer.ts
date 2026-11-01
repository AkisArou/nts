/*---
description: Three wider Set writers add different representations; original generic snapshots retain exact insertion order and all runtime values.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-map-set, ts-unions, ts-unknown, ts-unsound-generic-widening, ts-generics]
---*/
// put<T> adds object, number and undefined through unknown/union sets; snapshot<T> keeps the original
// number/string/object signatures and node returns all actual members.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function put<T>(items: Set<T>, value: T): void { items.add(value); }
function snapshot<T>(items: Set<T>): T[] { return Array.from(items); }
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const numbers = new Set<number>([n]), strings = new Set<string>([text]), objects = new Set<ContainerItem>([item]);
  put<unknown>(numbers, item); put<number | string>(strings, n); put<ContainerItem | undefined>(objects, undefined);
  const ns = snapshot<number>(numbers), ss = snapshot<string>(strings), os = snapshot<ContainerItem>(objects);
  same(ns[0], Object.is(n, -0) ? 0 : n); same(ns[1], item);
  same(ss[0], text); same(ss[1], Object.is(n, -0) ? 0 : n); same(os[0], item); same(os[1], undefined);
  assert.sameValue(ns.length, 2); assert.sameValue(ss.length, 2); assert.sameValue(os.length, 2);
  assert.sameValue(numbers.size, 2); assert.sameValue(strings.size, 2); assert.sameValue(objects.size, 2);
  assert.sameValue(numbers.has(ns[1]), true); assert.sameValue(strings.has(ss[1]), true); assert.sameValue(objects.has(os[1]), true);
}
