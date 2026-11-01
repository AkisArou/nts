/*---
description: Three object-or-null instantiations keep null selection, exact references and numeric payloads through one generic.
features: [ts-generic-routes, ts-generic-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-unions, ts-narrowing, ts-object-type, ts-unknown, ts-generics, ts-generic-constraints]
---*/
// prefer uses point|null, array|null and holder|null; node selects the fallback only for null and preserves each chosen reference.
type RoutePoint = { id: number };
type RouteHolder = { value: number | undefined };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function prefer<T extends object | null>(value: T, fallback: T): T { return value === null ? fallback : value; }
for (const n of [-0, NaN, 2.5]) {
  const point = { id: n }, next = { id: n + 1 }, values: (number | undefined)[] = [n, undefined], other = [undefined, n];
  const holder: RouteHolder = { value: n }, empty: RouteHolder = { value: undefined };
  const a = prefer<RoutePoint | null>(point, next); same(a, point);
  if (a !== null) same(a.id, n);
  same(prefer<RoutePoint | null>(null, next), next); same(prefer<RoutePoint | null>(null, null), null);
  const b = prefer<(number | undefined)[] | null>(values, other); same(b, values);
  if (b !== null) { same(b.length, 2); same(b[0], n); same(b[1], undefined); }
  same(prefer<(number | undefined)[] | null>(null, other), other); same(prefer<(number | undefined)[] | null>(null, null), null);
  const c = prefer<RouteHolder | null>(holder, empty); same(c, holder);
  if (c !== null) same(c.value, n);
  same(prefer<RouteHolder | null>(null, empty), empty); same(prefer<RouteHolder | null>(null, null), null);
}
