/*---
description: One generic reduce carries numeric, string, object and undefined accumulators through four type-argument pairs.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-unions, ts-unknown, ts-arrow-functions, ts-function-types, ts-closures, ts-generics]
---*/
// fold<T,U> reduces number, string, object and optional-number arrays into distinct accumulator types; node
// preserves every initial value, callback input and returned result.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function fold<T, U>(items: T[], initial: U, step: (previous: U, value: T) => U): U {
  return items.reduce(step, initial);
}
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const seed: ContainerItem = { id: n + 1 };
  const numberResult = fold<number, number | undefined>([n], undefined, (previous, value) => {
    same(previous, undefined); same(value, n); return value;
  });
  const stringResult = fold<string, string>([text], "seed", (previous, value) => {
    same(previous, "seed"); same(value, text); return value;
  });
  const objectResult = fold<ContainerItem, ContainerItem>([item], seed, (previous, value) => {
    same(previous, seed); same(value, item); return value;
  });
  const unknownResult = fold<number | undefined, unknown>([undefined], n, (previous, value) => {
    same(previous, n); same(value, undefined); return value;
  });
  same(numberResult, n); same(stringResult, text); same(objectResult, item); same(unknownResult, undefined);
}
