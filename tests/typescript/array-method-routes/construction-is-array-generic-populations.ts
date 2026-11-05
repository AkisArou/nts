/*---
description: "Array.isArray retains the same brand answer across generic mutable arrays, readonly arrays and non-array shapes."
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-generics, ts-generic-constraints, ts-unions, ts-objects, ts-strings, ts-readonly]
---*/

// Array.isArray retains the same brand answer across generic mutable arrays, readonly arrays and non-array shapes. Route: a constrained helper instantiated at six declared types. Node prints construction-is-array-generic-populations:ok.
function inspect<T extends object | string>(value: T, expected: boolean): void {
  const result = Array.isArray(value); assert.sameValue(result, expected);
}
const numbers: number[] = [-0, NaN], texts: readonly string[] = ["x", ""], emptyValues: number[] = [];
inspect<number[]>(numbers, true);
inspect<readonly string[]>(texts, true);
inspect<number[]>(emptyValues, true);
inspect<Uint8Array>(new Uint8Array([1]), false);
inspect<{ length: number }>({ length: 0 }, false);
inspect<string>("[]", false);
console.log("construction-is-array-generic-populations:ok");
