/*---
description: Control for narrowing-in-unions; expand each generic instantiation into its own non-generic declaration.
features: [ts-generic-routes, ts-generic-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-tuples, ts-unions, ts-narrowing, ts-unknown]
---*/
// Write each used type argument as a separate non-generic specialization; keep the inputs, computations and assertions.
type RoutePoint = { id: number };
type RouteCore = { number: number } | { text: string } | { reference: RoutePoint };
type RouteOptional = RouteCore | undefined;
type RouteNullable = RouteCore | undefined | null;
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function check(result: [unknown, unknown], original: unknown, payload: unknown): void {
  assert.sameValue(result.length, 2); same(result[0], original); same(result[1], payload);
}
function extractCore(value: RouteCore): [RouteCore, unknown] {
  if (value === undefined || value === null) return [value, value];
  if ("number" in value) return [value, value.number];
  if ("text" in value) return [value, value.text];
  return [value, value.reference];
}
function extractOptional(value: RouteOptional): [RouteOptional, unknown] {
  if (value === undefined || value === null) return [value, value];
  if ("number" in value) return [value, value.number];
  if ("text" in value) return [value, value.text];
  return [value, value.reference];
}
function extractNullable(value: RouteNullable): [RouteNullable, unknown] {
  if (value === undefined || value === null) return [value, value];
  if ("number" in value) return [value, value.number];
  if ("text" in value) return [value, value.text];
  return [value, value.reference];
}
for (const n of [-0, NaN, 2.5]) {
  const point = { id: n }, numeric = { number: n }, text = { text: String(n) }, reference = { reference: point };
  check(extractCore(numeric), numeric, n); check(extractCore(text), text, text.text);
  check(extractCore(reference), reference, point);
  check(extractOptional(numeric), numeric, n); check(extractOptional(text), text, text.text);
  check(extractOptional(reference), reference, point); check(extractOptional(undefined), undefined, undefined);
  check(extractNullable(numeric), numeric, n); check(extractNullable(text), text, text.text);
  check(extractNullable(reference), reference, point); check(extractNullable(undefined), undefined, undefined);
  check(extractNullable(null), null, null);
}
