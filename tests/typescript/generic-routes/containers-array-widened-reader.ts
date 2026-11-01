/*---
description: One array writer fills four element representations; wider instantiations of one reader preserve exact values and undefined.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-unions, ts-unknown, ts-generics]
---*/
// put<T> writes number, string, object and optional-number arrays; read<T> uses wider unions and unknown, and
// node retains every payload.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function put<T>(items: T[], value: T): void { items.push(value); }
function read<T>(items: T[], index: number): T { return items[index]; }
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const numbers: number[] = [], strings: string[] = [], objects: ContainerItem[] = [];
  const optional: (number | undefined)[] = [];
  put<number>(numbers, n); put<string>(strings, text); put<ContainerItem>(objects, item);
  put<number | undefined>(optional, n); put<number | undefined>(optional, undefined);
  same(read<number | string>(numbers, 0), n); same(read<string | undefined>(strings, 0), text);
  same(read<ContainerItem | undefined>(objects, 0), item);
  same(read<unknown>(optional, 0), n); same(read<unknown>(optional, 1), undefined);
  assert.sameValue(numbers.length, 1); assert.sameValue(strings.length, 1);
  assert.sameValue(objects.length, 1); assert.sameValue(optional.length, 2);
}
