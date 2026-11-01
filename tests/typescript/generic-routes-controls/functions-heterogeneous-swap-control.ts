/*---
description: Control for functions-heterogeneous-swap; use separate non-generic functions for each type argument.
features: [ts-generic-routes, ts-generic-route-functions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-arrays, ts-tuples, ts-bigint, ts-unions, ts-unknown]
---*/
// Write every specialization as its own non-generic function; keep the values, operations and assertions.
type FunctionPoint = { id: number };
function swapNumberString(values: [number, string]): [string, number] { return [values[1], values[0]]; }
function swapStringPoint(values: [string, FunctionPoint]): [FunctionPoint, string] { return [values[1], values[0]]; }
function swapPointUnion(values: [FunctionPoint, number | string]): [number | string, FunctionPoint] { return [values[1], values[0]]; }
function swapOptionalBigint(values: [number | undefined, bigint]): [bigint, number | undefined] { return [values[1], values[0]]; }
function swapBooleanUnknown(values: [boolean, unknown]): [unknown, boolean] { return [values[1], values[0]]; }
function swapUnknownNumber(values: [unknown, number]): [number, unknown] { return [values[1], values[0]]; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const numbers = [-0, NaN, 2.5], strings = ["", "seven", "tail"], bigints = [0n, -1n, 9007199254740993n];
for (let i = 0; i < numbers.length; i++) {
  const n = numbers[i], s = strings[i], big = bigints[i], b = i % 2 === 0;
  const point: FunctionPoint = { id: n };
  const optional: number | undefined = b ? n : undefined, mixed: number | string = b ? n : s;
  const hidden: unknown = i === 0 ? n : i === 1 ? undefined : point;
  const numberStringResult = swapNumberString([n, s]); same(numberStringResult.length, 2);
  same(numberStringResult[0], s); same(numberStringResult[1], n);
  const stringPointResult = swapStringPoint([s, point]); same(stringPointResult.length, 2);
  same(stringPointResult[0], point); same(stringPointResult[1], s);
  const pointUnionResult = swapPointUnion([point, mixed]); same(pointUnionResult.length, 2);
  same(pointUnionResult[0], mixed); same(pointUnionResult[1], point);
  const optionalBigintResult = swapOptionalBigint([optional, big]); same(optionalBigintResult.length, 2);
  same(optionalBigintResult[0], big); same(optionalBigintResult[1], optional);
  const booleanUnknownResult = swapBooleanUnknown([b, hidden]); same(booleanUnknownResult.length, 2);
  same(booleanUnknownResult[0], hidden); same(booleanUnknownResult[1], b);
  const unknownNumberResult = swapUnknownNumber([hidden, n]); same(unknownNumberResult.length, 2);
  same(unknownNumberResult[0], n); same(unknownNumberResult[1], hidden);
}
