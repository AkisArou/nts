/*---
description: "ReduceRight rejects an empty receiver without an initial value and returns a supplied signed zero unchanged."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-generics, ts-generic-constraints, ts-errors, ts-arrow-functions, ts-objects]
---*/

// ReduceRight rejects an empty receiver without an initial value and returns a supplied signed zero unchanged. Route: a constrained generic at two input record types.
// Node prints iteration-reduceright-empty-generic:ok.
type Values = Int16Array;
type Input = { data: Values }; type LabeledInput = { data: Values; label: string };
function reduceEmpty<T extends Input>(input: T): void {
  const data = input.data; let calls = 0; const callback = (sum: number, value: number): number => { calls++; return sum + value; };
  assert.throws(TypeError, () => data.reduceRight(callback));
  assert.sameValue(data.reduceRight(callback, -0), -0); assert.sameValue(calls, 0);
}
reduceEmpty<Input>({ data: new Int16Array([]) }); reduceEmpty<LabeledInput>({ data: new Int16Array([]), label: "second" });
console.log("iteration-reduceright-empty-generic:ok");
