/*---
description: A heterogeneous pair keeps each type-argument position distinct across six instantiations.
features: [ts-generic-routes, ts-generic-route-functions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-arrays, ts-tuples, ts-bigint, ts-unions, ts-unknown, ts-generics]
---*/
// Pair stores independent A and B slots for six primitive, object, optional, union and unknown combinations; node retains each exact value in its expected position.
type FunctionPoint = { id: number };
function pair<A, B>(first: A, second: B): [A, B] { return [first, second]; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const numbers = [-0, NaN, 2.5], strings = ["", "seven", "tail"], bigints = [0n, -1n, 9007199254740993n];
for (let i = 0; i < numbers.length; i++) {
  const n = numbers[i], s = strings[i], big = bigints[i], b = i % 2 === 0;
  const point: FunctionPoint = { id: n };
  const optional: number | undefined = b ? n : undefined, mixed: number | string = b ? n : s;
  const hidden: unknown = i === 0 ? n : i === 1 ? undefined : point;
  const numberStringResult = pair<number, string>(n, s); same(numberStringResult.length, 2);
  same(numberStringResult[0], n); same(numberStringResult[1], s);
  const stringPointResult = pair<string, FunctionPoint>(s, point); same(stringPointResult.length, 2);
  same(stringPointResult[0], s); same(stringPointResult[1], point);
  const pointUnionResult = pair<FunctionPoint, number | string>(point, mixed); same(pointUnionResult.length, 2);
  same(pointUnionResult[0], point); same(pointUnionResult[1], mixed);
  const optionalBigintResult = pair<number | undefined, bigint>(optional, big); same(optionalBigintResult.length, 2);
  same(optionalBigintResult[0], optional); same(optionalBigintResult[1], big);
  const booleanUnknownResult = pair<boolean, unknown>(b, hidden); same(booleanUnknownResult.length, 2);
  same(booleanUnknownResult[0], b); same(booleanUnknownResult[1], hidden);
  const unknownNumberResult = pair<unknown, number>(hidden, n); same(unknownNumberResult.length, 2);
  same(unknownNumberResult[0], hidden); same(unknownNumberResult[1], n);
}
