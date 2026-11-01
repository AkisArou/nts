/*---
description: Callback fields instantiated at four input/output pairs retain their saved arguments until a later method call.
features: [ts-generic-routes, ts-generic-route-callbacks, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-function-types, ts-arrow-functions, ts-closures, ts-class, ts-class-fields, ts-unions, ts-unknown, ts-generics]
---*/
// Pending stores four callback/value pairs before any run; node preserves captured numbers, strings, references and undefined on later calls.
type RoutePoint = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const seen: unknown[] = [];
class Pending<T, U> {
  value: T; callback: (value: T) => U;
  constructor(value: T, callback: (value: T) => U) { this.value = value; this.callback = callback; }
  run(): U { return this.callback(this.value); }
}
for (const n of [-0, NaN, 2.5]) {
  seen.length = 0;
  const word = String(n), point = { id: n }, maybe = n === 0 ? undefined : n;
  const a = new Pending<number, RoutePoint>(n, value => { seen.push(value); return point; });
  const b = new Pending<string, number>(word, value => { seen.push(value); return n; });
  const c = new Pending<RoutePoint, string>(point, value => { seen.push(value); return word; });
  const d = new Pending<number | undefined, number | undefined>(maybe, value => { seen.push(value); return value; });
  const mapped = a.run(); same(mapped, point); same(mapped.id, n);
  same(b.run(), n); same(c.run(), word); same(d.run(), maybe);
  const expected: unknown[] = [n, word, point, maybe];
  same(seen.length, expected.length);
  for (let i = 0; i < expected.length; i++) same(seen[i], expected[i]);
}
