/*---
description: Three object-union instantiations preserve the original object and the payload selected by in.
features: [ts-generic-routes, ts-generic-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-tuples, ts-unions, ts-narrowing, ts-unknown, ts-generics, ts-generic-constraints]
---*/
// extract uses three unions of numeric, string and reference fields, adding undefined and null; node keeps each selected field and identity.
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
function extract<T extends RouteNullable>(value: T): [T, unknown] {
  if (value === undefined || value === null) return [value, value];
  if ("number" in value) return [value, value.number];
  if ("text" in value) return [value, value.text];
  return [value, value.reference];
}
for (const n of [-0, NaN, 2.5]) {
  const point = { id: n }, numeric = { number: n }, text = { text: String(n) }, reference = { reference: point };
  check(extract<RouteCore>(numeric), numeric, n); check(extract<RouteCore>(text), text, text.text);
  check(extract<RouteCore>(reference), reference, point);
  check(extract<RouteOptional>(numeric), numeric, n); check(extract<RouteOptional>(text), text, text.text);
  check(extract<RouteOptional>(reference), reference, point); check(extract<RouteOptional>(undefined), undefined, undefined);
  check(extract<RouteNullable>(numeric), numeric, n); check(extract<RouteNullable>(text), text, text.text);
  check(extract<RouteNullable>(reference), reference, point); check(extract<RouteNullable>(undefined), undefined, undefined);
  check(extract<RouteNullable>(null), null, null);
}
