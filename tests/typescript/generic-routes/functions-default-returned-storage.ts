/*---
description: An omitted type argument really selects number beside string, object and union instances of one defaulted factory.
features: [ts-generic-routes, ts-generic-route-functions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-generic-defaults, ts-closures, ts-unions, ts-function-types, ts-generics]
---*/
// The no-argument channel defaults T to number; string, object and union channels store later writes, and node returns undefined before a write and the exact value afterwards.
type FunctionPoint = { id: number };
function channel<T = number>(): { put(value: T): T; get(): T | undefined } {
  let saved: T | undefined;
  return { put(value: T): T { saved = value; return value; }, get(): T | undefined { return saved; } };
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 2.5]) {
  const point: FunctionPoint = { id: n }, text = "value:" + n;
  const mixed: number | string = Object.is(n, -0) ? n : text;
  const numbers = channel(), strings = channel<string>(), objects = channel<FunctionPoint>(), unions = channel<number | string>();
  same(numbers.get(), undefined); same(strings.get(), undefined); same(objects.get(), undefined); same(unions.get(), undefined);
  same(numbers.put(n), n); same(strings.put(text), text); same(objects.put(point), point); same(unions.put(mixed), mixed);
  same(numbers.get(), n); same(strings.get(), text); same(objects.get(), point); same(unions.get(), mixed);
}
