/*---
description: Control for callbacks-field-deferred; expand each generic instantiation into its own non-generic declaration.
features: [ts-generic-routes, ts-generic-route-callbacks, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-function-types, ts-arrow-functions, ts-closures, ts-class, ts-class-fields, ts-unions, ts-unknown]
---*/
// Write each used type argument as a separate non-generic specialization; keep the inputs, computations and assertions.
type RoutePoint = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const seen: unknown[] = [];
class PendingNumberPoint {
  value: number; callback: (value: number) => RoutePoint;
  constructor(value: number, callback: (value: number) => RoutePoint) { this.value = value; this.callback = callback; }
  run(): RoutePoint { return this.callback(this.value); }
}
class PendingStringNumber {
  value: string; callback: (value: string) => number;
  constructor(value: string, callback: (value: string) => number) { this.value = value; this.callback = callback; }
  run(): number { return this.callback(this.value); }
}
class PendingPointString {
  value: RoutePoint; callback: (value: RoutePoint) => string;
  constructor(value: RoutePoint, callback: (value: RoutePoint) => string) { this.value = value; this.callback = callback; }
  run(): string { return this.callback(this.value); }
}
class PendingOptional {
  value: number | undefined; callback: (value: number | undefined) => number | undefined;
  constructor(value: number | undefined, callback: (value: number | undefined) => number | undefined) { this.value = value; this.callback = callback; }
  run(): number | undefined { return this.callback(this.value); }
}
for (const n of [-0, NaN, 2.5]) {
  seen.length = 0;
  const word = String(n), point = { id: n }, maybe = n === 0 ? undefined : n;
  const a = new PendingNumberPoint(n, value => { seen.push(value); return point; });
  const b = new PendingStringNumber(word, value => { seen.push(value); return n; });
  const c = new PendingPointString(point, value => { seen.push(value); return word; });
  const d = new PendingOptional(maybe, value => { seen.push(value); return value; });
  const mapped = a.run(); same(mapped, point); same(mapped.id, n);
  same(b.run(), n); same(c.run(), word); same(d.run(), maybe);
  const expected: unknown[] = [n, word, point, maybe];
  same(seen.length, expected.length);
  for (let i = 0; i < expected.length; i++) same(seen[i], expected[i]);
}
