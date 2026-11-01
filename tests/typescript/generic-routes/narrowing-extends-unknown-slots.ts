/*---
description: An extends unknown generic exchanges concrete, erased and undefined field payloads without changing their representations.
features: [ts-generic-routes, ts-generic-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-unknown, ts-generics, ts-generic-constraints]
---*/
// exchange uses number, string, object, unknown and undefined; node returns each previous value and stores the next payload exactly.
type RoutePoint = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function exchange<T extends unknown>(slot: { value: T }, next: T): T {
  const previous = slot.value; slot.value = next; return previous;
}
for (const n of [-0, NaN, 2.5]) {
  const word = String(n), point = { id: n }, next = { id: n + 1 };
  const numeric = { value: n }, text = { value: word }, reference = { value: point };
  const erased: { value: unknown } = { value: n }, empty: { value: undefined } = { value: undefined };
  same(exchange<number>(numeric, n + 1), n); same(numeric.value, n + 1);
  same(exchange<string>(text, word + "!"), word); same(text.value, word + "!");
  same(exchange<RoutePoint>(reference, next), point); same(reference.value, next);
  same(exchange<unknown>(erased, point), n); same(erased.value, point);
  same(exchange<unknown>(erased, undefined), point); same(erased.value, undefined);
  same(exchange<undefined>(empty, undefined), undefined); same(empty.value, undefined);
}
