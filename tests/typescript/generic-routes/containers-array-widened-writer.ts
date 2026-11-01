/*---
description: Three wider instantiations of an array writer replace narrow elements; the original reader specializations return the stored runtime values.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-unions, ts-unknown, ts-unsound-generic-widening, ts-generics]
---*/
// put<T> writes through unknown and union arrays while read<T> retains number, string and object signatures;
// node returns the object, number and undefined actually stored.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function put<T>(items: T[], value: T): void { items[0] = value; }
function read<T>(items: T[]): T { return items[0]; }
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const numbers: number[] = [n], strings: string[] = [text], objects: ContainerItem[] = [item];
  same(read<number>(numbers), n); same(read<string>(strings), text); same(read<ContainerItem>(objects), item);
  put<unknown>(numbers, item); put<number | string>(strings, n); put<ContainerItem | undefined>(objects, undefined);
  same(read<number>(numbers), item); same(read<string>(strings), n); same(read<ContainerItem>(objects), undefined);
  assert.sameValue(numbers.length, 1); assert.sameValue(strings.length, 1); assert.sameValue(objects.length, 1);
}
