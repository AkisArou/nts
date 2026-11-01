/*---
description: Control for functions-pair-storage; use separate non-generic functions for each type argument.
features: [ts-generic-routes, ts-generic-route-functions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-arrays, ts-tuples, ts-bigint, ts-unions]
---*/
// Write every specialization as its own non-generic function; keep the values, operations and assertions.
type FunctionPoint = { id: number };
function pairNumber(first: number, second: number): [number, number] { return [first, second]; }
function pairString(first: string, second: string): [string, string] { return [first, second]; }
function pairBoolean(first: boolean, second: boolean): [boolean, boolean] { return [first, second]; }
function pairBigint(first: bigint, second: bigint): [bigint, bigint] { return [first, second]; }
function pairPoint(first: FunctionPoint, second: FunctionPoint): [FunctionPoint, FunctionPoint] { return [first, second]; }
function pairOptional(first: number | undefined, second: number | undefined): [number | undefined, number | undefined] { return [first, second]; }
function pairUnion(first: number | string, second: number | string): [number | string, number | string] { return [first, second]; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const numbers = [-0, NaN, 2.5], strings = ["", "seven", "tail"], bigints = [0n, -1n, 9007199254740993n];
for (let i = 0; i < numbers.length; i++) {
  const n = numbers[i], next = numbers[(i + 1) % numbers.length], s = strings[i], tail = strings[(i + 1) % strings.length];
  const big = bigints[i], b = i % 2 === 0, point: FunctionPoint = { id: n }, other: FunctionPoint = { id: next };
  const optional: number | undefined = b ? n : undefined, mixed: number | string = b ? n : s;
  const numberResult = pairNumber(n, next); same(numberResult.length, 2);
  same(numberResult[0], n); same(numberResult[1], next);
  const stringResult = pairString(s, tail); same(stringResult.length, 2);
  same(stringResult[0], s); same(stringResult[1], tail);
  const booleanResult = pairBoolean(b, !b); same(booleanResult.length, 2);
  same(booleanResult[0], b); same(booleanResult[1], !b);
  const bigintResult = pairBigint(big, big + 1n); same(bigintResult.length, 2);
  same(bigintResult[0], big); same(bigintResult[1], big + 1n);
  const pointResult = pairPoint(point, other); same(pointResult.length, 2);
  same(pointResult[0], point); same(pointResult[1], other);
  const optionalResult = pairOptional(optional, undefined); same(optionalResult.length, 2);
  same(optionalResult[0], optional); same(optionalResult[1], undefined);
  const unionResult = pairUnion(mixed, tail); same(unionResult.length, 2);
  same(unionResult[0], mixed); same(unionResult[1], tail);
}
