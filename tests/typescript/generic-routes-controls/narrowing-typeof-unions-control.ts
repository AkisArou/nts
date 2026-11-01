/*---
description: Control for narrowing-typeof-unions; expand each generic instantiation into its own non-generic declaration.
features: [ts-generic-routes, ts-generic-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-tuples, ts-unions, ts-narrowing, ts-unknown]
---*/
// Write each used type argument as a separate non-generic specialization; keep the inputs, computations and assertions.
type RoutePoint = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function check(result: [unknown, string], expected: unknown, kind: string): void {
  assert.sameValue(result.length, 2); same(result[0], expected); same(result[1], kind);
}
function classifyUnion(value: number | string): [number | string, string] {
  if (typeof value === "number") return [value, "number"];
  if (typeof value === "string") return [value, "string"];
  return [value, value === undefined ? "undefined" : "object"];
}
function classifyOptional(value: number | string | undefined): [number | string | undefined, string] {
  if (typeof value === "number") return [value, "number"];
  if (typeof value === "string") return [value, "string"];
  return [value, value === undefined ? "undefined" : "object"];
}
function classifyObject(value: number | string | RoutePoint): [number | string | RoutePoint, string] {
  if (typeof value === "number") return [value, "number"];
  if (typeof value === "string") return [value, "string"];
  return [value, value === undefined ? "undefined" : "object"];
}
for (const n of [-0, NaN, 2.5]) {
  const word = String(n), point = { id: n };
  check(classifyUnion(n), n, "number");
  check(classifyUnion(word), word, "string");
  check(classifyOptional(n), n, "number");
  check(classifyOptional(word), word, "string");
  check(classifyOptional(undefined), undefined, "undefined");
  check(classifyObject(n), n, "number");
  check(classifyObject(word), word, "string");
  check(classifyObject(point), point, "object");
}
