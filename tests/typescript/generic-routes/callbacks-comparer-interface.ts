/*---
description: Four Comparer implementations receive exact arguments and return the selected T through a generic caller.
features: [ts-generic-routes, ts-generic-route-callbacks, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-interfaces, ts-class, ts-unions, ts-unknown, ts-generics]
---*/
// choose uses numeric, string, object and optional Comparer interfaces; node keeps every argument and the selected payload.
type RoutePoint = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const seen: unknown[] = [];
interface Comparer<T> { compare(a: T, b: T): number; }
class NumberComparer implements Comparer<number> { compare(a: number, b: number): number { seen.push(a, b); return a < b ? -1 : 1; } }
class StringComparer implements Comparer<string> { compare(a: string, b: string): number { seen.push(a, b); return a < b ? -1 : 1; } }
class PointComparer implements Comparer<RoutePoint> { compare(a: RoutePoint, b: RoutePoint): number { seen.push(a, b); return a.id < b.id ? -1 : 1; } }
class OptionalComparer implements Comparer<number | undefined> { compare(a: number | undefined, b: number | undefined): number { seen.push(a, b); return a === undefined ? -1 : b === undefined ? 1 : a < b ? -1 : 1; } }
function choose<T>(comparer: Comparer<T>, a: T, b: T): T { return comparer.compare(a, b) < 0 ? a : b; }
for (const n of [-0, NaN, 2.5]) {
  seen.length = 0;
  const word = String(n), point = { id: n }, other = { id: 5 };
  same(choose<number>(new NumberComparer(), n, 5), n < 5 ? n : 5);
  same(choose<string>(new StringComparer(), word, "m"), word < "m" ? word : "m");
  same(choose<RoutePoint>(new PointComparer(), point, other), n < 5 ? point : other);
  same(choose<number | undefined>(new OptionalComparer(), undefined, n), undefined);
  const expected: unknown[] = [n, 5, word, "m", point, other, undefined, n];
  same(seen.length, expected.length);
  for (let i = 0; i < expected.length; i++) same(seen[i], expected[i]);
}
