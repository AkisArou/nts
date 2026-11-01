/*---
description: Three union instantiations retain their exact payloads through typeof branches in one generic.
features: [ts-generic-routes, ts-generic-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-tuples, ts-unions, ts-narrowing, ts-unknown, ts-generics, ts-generic-constraints]
---*/
// classify uses number|string, its optional form and its object form; node keeps each returned payload and branch label.
type RoutePoint = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function check(result: [unknown, string], expected: unknown, kind: string): void {
  assert.sameValue(result.length, 2); same(result[0], expected); same(result[1], kind);
}
function classify<T extends number | string | RoutePoint | undefined>(value: T): [T, string] {
  if (typeof value === "number") return [value, "number"];
  if (typeof value === "string") return [value, "string"];
  return [value, value === undefined ? "undefined" : "object"];
}
for (const n of [-0, NaN, 2.5]) {
  const word = String(n), point = { id: n };
  check(classify<number | string>(n), n, "number");
  check(classify<number | string>(word), word, "string");
  check(classify<number | string | undefined>(n), n, "number");
  check(classify<number | string | undefined>(word), word, "string");
  check(classify<number | string | undefined>(undefined), undefined, "undefined");
  check(classify<number | string | RoutePoint>(n), n, "number");
  check(classify<number | string | RoutePoint>(word), word, "string");
  check(classify<number | string | RoutePoint>(point), point, "object");
}
