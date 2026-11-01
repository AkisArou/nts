/*---
description: Control for narrowing-object-null-constraint; expand each generic instantiation into its own non-generic declaration.
features: [ts-generic-routes, ts-generic-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-unions, ts-narrowing, ts-object-type, ts-unknown]
---*/
// Write each used type argument as a separate non-generic specialization; keep the inputs, computations and assertions.
type RoutePoint = { id: number };
type RouteHolder = { value: number | undefined };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function preferPoint(value: RoutePoint | null, fallback: RoutePoint | null): RoutePoint | null { return value === null ? fallback : value; }
function preferArray(value: (number | undefined)[] | null, fallback: (number | undefined)[] | null): (number | undefined)[] | null { return value === null ? fallback : value; }
function preferHolder(value: RouteHolder | null, fallback: RouteHolder | null): RouteHolder | null { return value === null ? fallback : value; }
for (const n of [-0, NaN, 2.5]) {
  const point = { id: n }, next = { id: n + 1 }, values: (number | undefined)[] = [n, undefined], other = [undefined, n];
  const holder: RouteHolder = { value: n }, empty: RouteHolder = { value: undefined };
  const a = preferPoint(point, next); same(a, point);
  if (a !== null) same(a.id, n);
  same(preferPoint(null, next), next); same(preferPoint(null, null), null);
  const b = preferArray(values, other); same(b, values);
  if (b !== null) { same(b.length, 2); same(b[0], n); same(b[1], undefined); }
  same(preferArray(null, other), other); same(preferArray(null, null), null);
  const c = preferHolder(holder, empty); same(c, holder);
  if (c !== null) same(c.value, n);
  same(preferHolder(null, empty), empty); same(preferHolder(null, null), null);
}
