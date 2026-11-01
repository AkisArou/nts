/*---
description: One generic calls another, stores T in a typed result field and reads it at nine instantiations.
features: [ts-generic-routes, ts-generic-route-functions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-arrays, ts-bigint, ts-unions, ts-unknown, ts-generics]
---*/
// Relay forwards number, string, boolean, bigint, object, optional, union, unknown and undefined to store<T>; node returns the original value from its field.
type FunctionPoint = { id: number };
function store<T>(value: T): { value: T } { return { value }; }
function relay<T>(value: T): T { return store<T>(value).value; }
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const numbers = [-0, NaN, 2.5], strings = ["", "seven", "tail"], bigints = [0n, -1n, 9007199254740993n];
for (let i = 0; i < numbers.length; i++) {
  const n = numbers[i], s = strings[i], big = bigints[i], b = i % 2 === 0;
  const point: FunctionPoint = { id: n };
  const optional: number | undefined = b ? n : undefined, mixed: number | string = b ? n : s;
  const hidden: unknown = i === 0 ? n : i === 1 ? undefined : point;
  same(relay<number>(n), n);
  same(relay<string>(s), s);
  same(relay<boolean>(b), b);
  same(relay<bigint>(big), big);
  same(relay<FunctionPoint>(point), point);
  same(relay<number | undefined>(optional), optional);
  same(relay<number | string>(mixed), mixed);
  same(relay<unknown>(hidden), hidden);
  same(relay<undefined>(undefined), undefined);
}
