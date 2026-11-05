/*---
description: "ReduceRight rejects an empty receiver without an initial value and returns a supplied signed zero unchanged. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-generics, ts-generic-constraints, ts-errors, ts-arrow-functions, ts-objects]
---*/

function localInt16Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localReduceRight(data: number[], callback: (sum: number, value: number, index: number, self: number[]) => number, initial?: number): number {
  if (data.length === 0 && initial === undefined) throw new TypeError("empty"); let sum = initial === undefined ? data[data.length - 1] : initial;
  for (let i = data.length - (initial === undefined ? 2 : 1); i >= 0; i--) sum = callback(sum, data[i], i, data); return sum;
}
// ReduceRight rejects an empty receiver without an initial value and returns a supplied signed zero unchanged. Route: a constrained generic at two input record types.
// Node prints iteration-reduceright-empty-generic:ok.
type Values = number[];
type Input = { data: Values }; type LabeledInput = { data: Values; label: string };
function reduceEmpty<T extends Input>(input: T): void {
  const data = input.data; let calls = 0; const callback = (sum: number, value: number): number => { calls++; return sum + value; };
  assert.throws(TypeError, () => localReduceRight(data, callback));
  assert.sameValue(localReduceRight(data, callback, -0), -0); assert.sameValue(calls, 0);
}
reduceEmpty<Input>({ data: localInt16Array([]) }); reduceEmpty<LabeledInput>({ data: localInt16Array([]), label: "second" });
console.log("iteration-reduceright-empty-generic:ok");
