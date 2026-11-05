/*---
description: "Flat zero copies the outer array and flat one preserves exact generic element identities through a constrained helper at numeric and reference type arguments. (control)"
features: [ts-array-method-routes, ts-array-method-route-copies, ts-arrays, ts-functions, ts-iteration, ts-generics, ts-generic-constraints, ts-readonly, ts-unions, ts-type-aliases, ts-numbers, ts-objects, ts-unknown]
---*/

type LocalFlatValue = number | string | null | undefined | { id: number } | readonly LocalFlatValue[];
function localFlat(items: readonly LocalFlatValue[], depth: number = 1): LocalFlatValue[] {
  const result: LocalFlatValue[] = [];
  function append(values: readonly LocalFlatValue[], level: number): void {
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (level > 0 && typeof value === "object" && value !== null && !("id" in value)) append(value, level - 1);
      else result[result.length] = value;
    }
  }
  append(items, depth !== depth ? 0 : depth === Infinity ? depth : depth - depth % 1);
  return result;
}
// Flat zero copies the outer array and flat one preserves exact generic element identities; route: a constrained helper at numeric and reference type arguments.
// Node prints copies-flat-generic-shallow-levels:ok.
type Token = { id: number };
function check<T extends number | Token>(first: T, last: T): void {
  const inner: T[] = [last, first], input: (T | T[])[] = [first, inner, last];
  const shallow: readonly unknown[] = localFlat(input, 0);
  const flattened: readonly unknown[] = localFlat(input, 1);
  assert.compareArray(shallow, [first, inner, last]);
  assert.compareArray(flattened, [first, last, first, last]);
  assert.sameValue(shallow === input, false);
  assert.sameValue(flattened === input, false);
  assert.sameValue(shallow[1], inner);
  assert.compareArray(input, [first, inner, last]);
  assert.compareArray(inner, [last, first]);
}
check<number>(-0, NaN);
const first: Token = { id: 1 }, last: Token = { id: 4 };
check<Token>(first, last);
console.log("copies-flat-generic-shallow-levels:ok");
