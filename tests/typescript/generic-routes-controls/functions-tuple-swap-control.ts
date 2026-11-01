/*---
description: Control for functions-tuple-swap; use separate non-generic functions for each type argument.
features: [ts-generic-routes, ts-generic-route-functions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-arrays, ts-tuples, ts-bigint, ts-unions]
---*/
// Write every specialization as its own non-generic function; keep the values, operations and assertions.
type FunctionPoint = { id: number };
function swapNumber(values: [number, number]): [number, number] { return [values[1], values[0]]; }
function swapString(values: [string, string]): [string, string] { return [values[1], values[0]]; }
function swapBoolean(values: [boolean, boolean]): [boolean, boolean] { return [values[1], values[0]]; }
function swapBigint(values: [bigint, bigint]): [bigint, bigint] { return [values[1], values[0]]; }
function swapPoint(values: [FunctionPoint, FunctionPoint]): [FunctionPoint, FunctionPoint] { return [values[1], values[0]]; }
function swapOptional(values: [number | undefined, number | undefined]): [number | undefined, number | undefined] { return [values[1], values[0]]; }
function swapUnion(values: [number | string, number | string]): [number | string, number | string] { return [values[1], values[0]]; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const numbers = [-0, NaN, 2.5], strings = ["", "seven", "tail"], bigints = [0n, -1n, 9007199254740993n];
for (let i = 0; i < numbers.length; i++) {
  const n = numbers[i], next = numbers[(i + 1) % numbers.length], s = strings[i], tail = strings[(i + 1) % strings.length];
  const big = bigints[i], b = i % 2 === 0, point: FunctionPoint = { id: n }, other: FunctionPoint = { id: next };
  const optional: number | undefined = b ? n : undefined, mixed: number | string = b ? n : s;
  const numberResult = swapNumber([n, next]); same(numberResult.length, 2);
  same(numberResult[0], next); same(numberResult[1], n);
  const stringResult = swapString([s, tail]); same(stringResult.length, 2);
  same(stringResult[0], tail); same(stringResult[1], s);
  const booleanResult = swapBoolean([b, !b]); same(booleanResult.length, 2);
  same(booleanResult[0], !b); same(booleanResult[1], b);
  const bigintResult = swapBigint([big, big + 1n]); same(bigintResult.length, 2);
  same(bigintResult[0], big + 1n); same(bigintResult[1], big);
  const pointResult = swapPoint([point, other]); same(pointResult.length, 2);
  same(pointResult[0], other); same(pointResult[1], point);
  const optionalResult = swapOptional([optional, undefined]); same(optionalResult.length, 2);
  same(optionalResult[0], undefined); same(optionalResult[1], optional);
  const unionResult = swapUnion([mixed, tail]); same(unionResult.length, 2);
  same(unionResult[0], tail); same(unionResult[1], mixed);
}
