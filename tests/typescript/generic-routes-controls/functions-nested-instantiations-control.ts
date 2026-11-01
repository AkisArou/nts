/*---
description: Control for functions-nested-instantiations; use separate non-generic functions for each type argument.
features: [ts-generic-routes, ts-generic-route-functions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-arrays, ts-bigint, ts-unions, ts-unknown]
---*/
// Write every specialization as its own non-generic function; keep the values, operations and assertions.
type FunctionPoint = { id: number };
function storeNumber(value: number): { value: number } { return { value }; }
function relayNumber(value: number): number { return storeNumber(value).value; }
function storeString(value: string): { value: string } { return { value }; }
function relayString(value: string): string { return storeString(value).value; }
function storeBoolean(value: boolean): { value: boolean } { return { value }; }
function relayBoolean(value: boolean): boolean { return storeBoolean(value).value; }
function storeBigint(value: bigint): { value: bigint } { return { value }; }
function relayBigint(value: bigint): bigint { return storeBigint(value).value; }
function storePoint(value: FunctionPoint): { value: FunctionPoint } { return { value }; }
function relayPoint(value: FunctionPoint): FunctionPoint { return storePoint(value).value; }
function storeOptional(value: number | undefined): { value: number | undefined } { return { value }; }
function relayOptional(value: number | undefined): number | undefined { return storeOptional(value).value; }
function storeUnion(value: number | string): { value: number | string } { return { value }; }
function relayUnion(value: number | string): number | string { return storeUnion(value).value; }
function storeUnknown(value: unknown): { value: unknown } { return { value }; }
function relayUnknown(value: unknown): unknown { return storeUnknown(value).value; }
function storeUndefined(value: undefined): { value: undefined } { return { value }; }
function relayUndefined(value: undefined): undefined { return storeUndefined(value).value; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const numbers = [-0, NaN, 2.5], strings = ["", "seven", "tail"], bigints = [0n, -1n, 9007199254740993n];
for (let i = 0; i < numbers.length; i++) {
  const n = numbers[i], s = strings[i], big = bigints[i], b = i % 2 === 0;
  const point: FunctionPoint = { id: n };
  const optional: number | undefined = b ? n : undefined, mixed: number | string = b ? n : s;
  const hidden: unknown = i === 0 ? n : i === 1 ? undefined : point;
  same(relayNumber(n), n);
  same(relayString(s), s);
  same(relayBoolean(b), b);
  same(relayBigint(big), big);
  same(relayPoint(point), point);
  same(relayOptional(optional), optional);
  same(relayUnion(mixed), mixed);
  same(relayUnknown(hidden), hidden);
  same(relayUndefined(undefined), undefined);
}
