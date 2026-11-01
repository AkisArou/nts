/*---
description: A heterogeneous swap keeps each type-argument position distinct across six instantiations.
features: [ts-generic-routes, ts-generic-route-functions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-arrays, ts-tuples, ts-bigint, ts-unions, ts-unknown, ts-generics]
---*/
// Swap reverses the A and B slots for six primitive, object, optional, union and unknown combinations; node retains each exact value in its expected position.
type FunctionPoint = { id: number };
function swap<A, B>(values: [A, B]): [B, A] { return [values[1], values[0]]; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const numbers = [-0, NaN, 2.5], strings = ["", "seven", "tail"], bigints = [0n, -1n, 9007199254740993n];
for (let i = 0; i < numbers.length; i++) {
  const n = numbers[i], s = strings[i], big = bigints[i], b = i % 2 === 0;
  const point: FunctionPoint = { id: n };
  const optional: number | undefined = b ? n : undefined, mixed: number | string = b ? n : s;
  const hidden: unknown = i === 0 ? n : i === 1 ? undefined : point;
  const numberStringResult = swap<number, string>([n, s]); same(numberStringResult.length, 2);
  same(numberStringResult[0], s); same(numberStringResult[1], n);
  const stringPointResult = swap<string, FunctionPoint>([s, point]); same(stringPointResult.length, 2);
  same(stringPointResult[0], point); same(stringPointResult[1], s);
  const pointUnionResult = swap<FunctionPoint, number | string>([point, mixed]); same(pointUnionResult.length, 2);
  same(pointUnionResult[0], mixed); same(pointUnionResult[1], point);
  const optionalBigintResult = swap<number | undefined, bigint>([optional, big]); same(optionalBigintResult.length, 2);
  same(optionalBigintResult[0], big); same(optionalBigintResult[1], optional);
  const booleanUnknownResult = swap<boolean, unknown>([b, hidden]); same(booleanUnknownResult.length, 2);
  same(booleanUnknownResult[0], hidden); same(booleanUnknownResult[1], b);
  const unknownNumberResult = swap<unknown, number>([hidden, n]); same(unknownNumberResult.length, 2);
  same(unknownNumberResult[0], n); same(unknownNumberResult[1], hidden);
}
