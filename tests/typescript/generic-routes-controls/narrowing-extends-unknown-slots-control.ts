/*---
description: Control for narrowing-extends-unknown-slots; expand each generic instantiation into its own non-generic declaration.
features: [ts-generic-routes, ts-generic-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-unknown]
---*/
// Write each used type argument as a separate non-generic specialization; keep the inputs, computations and assertions.
type RoutePoint = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function exchangeNumber(slot: { value: number }, next: number): number {
  const previous = slot.value; slot.value = next; return previous;
}
function exchangeString(slot: { value: string }, next: string): string {
  const previous = slot.value; slot.value = next; return previous;
}
function exchangePoint(slot: { value: RoutePoint }, next: RoutePoint): RoutePoint {
  const previous = slot.value; slot.value = next; return previous;
}
function exchangeUnknown(slot: { value: unknown }, next: unknown): unknown {
  const previous = slot.value; slot.value = next; return previous;
}
function exchangeUndefined(slot: { value: undefined }, next: undefined): undefined {
  const previous = slot.value; slot.value = next; return previous;
}
for (const n of [-0, NaN, 2.5]) {
  const word = String(n), point = { id: n }, next = { id: n + 1 };
  const numeric = { value: n }, text = { value: word }, reference = { value: point };
  const erased: { value: unknown } = { value: n }, empty: { value: undefined } = { value: undefined };
  same(exchangeNumber(numeric, n + 1), n); same(numeric.value, n + 1);
  same(exchangeString(text, word + "!"), word); same(text.value, word + "!");
  same(exchangePoint(reference, next), point); same(reference.value, next);
  same(exchangeUnknown(erased, point), n); same(erased.value, point);
  same(exchangeUnknown(erased, undefined), point); same(erased.value, undefined);
  same(exchangeUndefined(empty, undefined), undefined); same(empty.value, undefined);
}
