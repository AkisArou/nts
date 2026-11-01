/*---
description: One identity function preserves exact values across nine explicit instantiations.
features: [ts-generic-routes, ts-generic-route-functions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-arrays, ts-bigint, ts-unions, ts-unknown, ts-generics]
---*/
// Identity uses number, string, boolean, bigint, object, optional, union, unknown and undefined arguments; node returns each exact input.
type FunctionPoint = { id: number };
function identity<T>(value: T): T { return value; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const numbers = [-0, NaN, 2.5], strings = ["", "seven", "tail"], bigints = [0n, -1n, 9007199254740993n];
for (let i = 0; i < numbers.length; i++) {
  const n = numbers[i], s = strings[i], big = bigints[i], b = i % 2 === 0;
  const point: FunctionPoint = { id: n };
  const optional: number | undefined = b ? n : undefined, mixed: number | string = b ? n : s;
  const hidden: unknown = i === 0 ? n : i === 1 ? undefined : point;
  same(identity<number>(n), n);
  same(identity<string>(s), s);
  same(identity<boolean>(b), b);
  same(identity<bigint>(big), big);
  same(identity<FunctionPoint>(point), point);
  same(identity<number | undefined>(optional), optional);
  same(identity<number | string>(mixed), mixed);
  same(identity<unknown>(hidden), hidden);
  same(identity<undefined>(undefined), undefined);
}
