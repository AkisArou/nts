/*---
description: Control for functions-default-returned-storage; use separate non-generic functions for each type argument.
features: [ts-generic-routes, ts-generic-route-functions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-closures, ts-unions, ts-function-types]
---*/
// Write every specialization as its own non-generic function; keep the values, operations and assertions.
type FunctionPoint = { id: number };
function channelNumber(): { put(value: number): number; get(): number | undefined } {
  let saved: number | undefined;
  return { put(value: number): number { saved = value; return value; }, get(): number | undefined { return saved; } };
}
function channelString(): { put(value: string): string; get(): string | undefined } {
  let saved: string | undefined;
  return { put(value: string): string { saved = value; return value; }, get(): string | undefined { return saved; } };
}
function channelPoint(): { put(value: FunctionPoint): FunctionPoint; get(): FunctionPoint | undefined } {
  let saved: FunctionPoint | undefined;
  return { put(value: FunctionPoint): FunctionPoint { saved = value; return value; }, get(): FunctionPoint | undefined { return saved; } };
}
function channelUnion(): { put(value: number | string): number | string; get(): number | string | undefined } {
  let saved: number | string | undefined;
  return { put(value: number | string): number | string { saved = value; return value; }, get(): number | string | undefined { return saved; } };
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-0, NaN, 2.5]) {
  const point: FunctionPoint = { id: n }, text = "value:" + n;
  const mixed: number | string = Object.is(n, -0) ? n : text;
  const numbers = channelNumber(), strings = channelString(), objects = channelPoint(), unions = channelUnion();
  same(numbers.get(), undefined); same(strings.get(), undefined); same(objects.get(), undefined); same(unions.get(), undefined);
  same(numbers.put(n), n); same(strings.put(text), text); same(objects.put(point), point); same(unions.put(mixed), mixed);
  same(numbers.get(), n); same(strings.get(), text); same(objects.get(), point); same(unions.get(), mixed);
}
