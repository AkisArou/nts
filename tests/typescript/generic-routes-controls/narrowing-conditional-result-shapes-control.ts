/*---
description: Control for narrowing-conditional-result-shapes; expand each generic instantiation into its own non-generic declaration.
features: [ts-generic-routes, ts-generic-route-narrowing, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-unions, ts-narrowing, ts-unknown]
---*/
// Write each used type argument as a separate non-generic specialization; keep the inputs, computations and assertions.
type RoutePoint = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
type PayloadNumber = { value: number };
function retainNumber(value: PayloadNumber): PayloadNumber { const stored: PayloadNumber[] = [value]; return stored[0]; }
type PayloadString = { text: string };
function retainString(value: PayloadString): PayloadString { const stored: PayloadString[] = [value]; return stored[0]; }
type PayloadPoint = { value: RoutePoint };
function retainPoint(value: PayloadPoint): PayloadPoint { const stored: PayloadPoint[] = [value]; return stored[0]; }
type PayloadUndefined = { value: undefined };
function retainUndefined(value: PayloadUndefined): PayloadUndefined { const stored: PayloadUndefined[] = [value]; return stored[0]; }
type PayloadUnion = { value: number } | { text: string };
function retainUnion(value: PayloadUnion): PayloadUnion { const stored: PayloadUnion[] = [value]; return stored[0]; }
for (const n of [-0, NaN, 2.5]) {
  const point = { id: n }, numeric = { value: n }, text = { text: String(n) }, reference = { value: point }, empty = { value: undefined };
  const a = retainNumber(numeric); same(a, numeric); same(a.value, n);
  const b = retainString(text); same(b, text); same(b.text, text.text);
  const c = retainPoint(reference); same(c, reference); same(c.value, point); same(c.value.id, n);
  const d = retainUndefined(empty); same(d, empty); same(d.value, undefined);
  const mixed: PayloadUnion = n === 0 ? numeric : text;
  const e = retainUnion(mixed); same(e, mixed);
  if ("text" in e) same(e.text, text.text); else same(e.value, n);
}
