/*---
description: "Array.from maps length-only undefined values and indexed numeric values with the correct position argument."
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints, ts-unions, ts-null-undefined, ts-readonly, ts-objects, ts-arrow-functions, ts-typeof-operator, ts-narrowing]
---*/

// Array.from maps length-only undefined values and indexed numeric values with the correct position argument. Route: a constrained ArrayLike helper at undefined and number type arguments. Node prints construction-from-arraylike-generic-mapper:ok.
function inspect<T extends number | undefined>(source: ArrayLike<T>, expected: readonly number[]): void {
  const result = Array.from(source, (value, index) => typeof value === "number" ? value + index * 10 : index * index);
  assert.compareArray(result, expected);
  for (let index = 0; index < result.length; index++) assert.sameValue(index in result, true);
}
inspect<undefined>({ length: 3 }, [0, 1, 4]);
inspect<undefined>({ length: 0 }, []);
inspect<number>({ 0: 7, 1: 7, 2: 2, length: 3 }, [7, 17, 22]);
inspect<number>({ 0: 9, length: 1 }, [9]);
console.log("construction-from-arraylike-generic-mapper:ok");
