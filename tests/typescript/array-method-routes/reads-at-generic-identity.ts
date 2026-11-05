/*---
description: "at preserves signed zero, NaN and object identities across constrained generic instantiations."
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints, ts-objects, ts-readonly, ts-unions, ts-null-undefined, ts-typeof-operator, ts-narrowing]
---*/

// at preserves signed zero, NaN and object identities across constrained generic instantiations. Route: a constrained helper at number and record type arguments. Node prints reads-at-generic-identity:ok.
function inspect<T extends number | { id: number }>(items: readonly T[], expected: readonly (T | undefined)[]): void {
  const indices: readonly number[] = [0, -1, 1.7, -2.7, 3];
  for (let i = 0; i < indices.length; i++) {
    const found = items.at(indices[i]);
    if (typeof found === "object") assert.sameValue(found === expected[i], true);
    else assert.sameValue(Object.is(found, expected[i]), true);
  }
}
inspect<number>([-0, NaN, 7], [-0, 7, NaN, NaN, undefined]);
const first = { id: 1 }, second = { id: 2 };
inspect<{ id: number }>([first, second, first], [first, first, second, second, undefined]);
console.log("reads-at-generic-identity:ok");
