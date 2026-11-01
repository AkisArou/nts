/*---
description: Control for containers-array-reduce-specializations; spell out each generic specialization as a separate function.
features: [ts-generic-routes, ts-generic-route-containers, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-type-aliases, ts-unions, ts-unknown, ts-arrow-functions, ts-function-types, ts-closures]
---*/
// Use separate non-generic functions for each type argument; the values, container operations and assertions
// are unchanged.
type ContainerItem = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function foldNumber(items: number[], initial: number | undefined, step: (previous: number | undefined, value: number) => number | undefined): number | undefined {
  return items.reduce(step, initial);
}
function foldString(items: string[], initial: string, step: (previous: string, value: string) => string): string {
  return items.reduce(step, initial);
}
function foldItem(items: ContainerItem[], initial: ContainerItem, step: (previous: ContainerItem, value: ContainerItem) => ContainerItem): ContainerItem {
  return items.reduce(step, initial);
}
function foldUnknown(items: (number | undefined)[], initial: unknown, step: (previous: unknown, value: number | undefined) => unknown): unknown {
  return items.reduce(step, initial);
}
for (const n of [-0, NaN, 2.5]) {
  const text = "v:" + String(n), item: ContainerItem = { id: n };
  const seed: ContainerItem = { id: n + 1 };
  const numberResult = foldNumber([n], undefined, (previous, value) => {
    same(previous, undefined); same(value, n); return value;
  });
  const stringResult = foldString([text], "seed", (previous, value) => {
    same(previous, "seed"); same(value, text); return value;
  });
  const objectResult = foldItem([item], seed, (previous, value) => {
    same(previous, seed); same(value, item); return value;
  });
  const unknownResult = foldUnknown([undefined], n, (previous, value) => {
    same(previous, n); same(value, undefined); return value;
  });
  same(numberResult, n); same(stringResult, text); same(objectResult, item); same(unknownResult, undefined);
}
