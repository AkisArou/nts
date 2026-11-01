/*---
description: Conditional shapes resolved for five type arguments retain their exact field values and object identities.
features: [ts-generic-routes, ts-generic-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-unions, ts-narrowing, ts-unknown, ts-generics, ts-conditional-types, ts-type-operators]
---*/
// retain uses number, string, object, undefined and a distributed union; node keeps each selected conditional shape and its field payload.
type RoutePoint = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type Payload<T> = T extends string ? { text: T } : { value: T };
function retain<T>(value: Payload<T>): Payload<T> { const stored: Payload<T>[] = [value]; return stored[0]; }
for (const n of [-0, NaN, 2.5]) {
  const point = { id: n }, numeric = { value: n }, text = { text: String(n) }, reference = { value: point }, empty = { value: undefined };
  const a = retain<number>(numeric); same(a, numeric); same(a.value, n);
  const b = retain<string>(text); same(b, text); same(b.text, text.text);
  const c = retain<RoutePoint>(reference); same(c, reference); same(c.value, point); same(c.value.id, n);
  const d = retain<undefined>(empty); same(d, empty); same(d.value, undefined);
  const mixed: Payload<number | string> = n === 0 ? numeric : text;
  const e = retain<number | string>(mixed); same(e, mixed);
  if ("text" in e) same(e.text, text.text); else same(e.value, n);
}
