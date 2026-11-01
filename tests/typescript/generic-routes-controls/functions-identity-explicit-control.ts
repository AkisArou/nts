/*---
description: Control for functions-identity-explicit; use separate non-generic functions for each type argument.
features: [ts-generic-routes, ts-generic-route-functions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-arrays, ts-bigint, ts-unions, ts-unknown]
---*/
// Write every specialization as its own non-generic function; keep the values, operations and assertions.
type FunctionPoint = { id: number };
function identityNumber(value: number): number { return value; }
function identityString(value: string): string { return value; }
function identityBoolean(value: boolean): boolean { return value; }
function identityBigint(value: bigint): bigint { return value; }
function identityPoint(value: FunctionPoint): FunctionPoint { return value; }
function identityOptional(value: number | undefined): number | undefined { return value; }
function identityUnion(value: number | string): number | string { return value; }
function identityUnknown(value: unknown): unknown { return value; }
function identityUndefined(value: undefined): undefined { return value; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const numbers = [-0, NaN, 2.5], strings = ["", "seven", "tail"], bigints = [0n, -1n, 9007199254740993n];
for (let i = 0; i < numbers.length; i++) {
  const n = numbers[i], s = strings[i], big = bigints[i], b = i % 2 === 0;
  const point: FunctionPoint = { id: n };
  const optional: number | undefined = b ? n : undefined, mixed: number | string = b ? n : s;
  const hidden: unknown = i === 0 ? n : i === 1 ? undefined : point;
  same(identityNumber(n), n);
  same(identityString(s), s);
  same(identityBoolean(b), b);
  same(identityBigint(big), big);
  same(identityPoint(point), point);
  same(identityOptional(optional), optional);
  same(identityUnion(mixed), mixed);
  same(identityUnknown(hidden), hidden);
  same(identityUndefined(undefined), undefined);
}
