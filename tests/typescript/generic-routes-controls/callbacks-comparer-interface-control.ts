/*---
description: Control for callbacks-comparer-interface; expand each generic instantiation into its own non-generic declaration.
features: [ts-generic-routes, ts-generic-route-callbacks, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-interfaces, ts-class, ts-unions, ts-unknown]
---*/
// Write each used type argument as a separate non-generic specialization; keep the inputs, computations and assertions.
type RoutePoint = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const seen: unknown[] = [];
interface ComparerNumber { compare(a: number, b: number): number; }
interface ComparerString { compare(a: string, b: string): number; }
interface ComparerPoint { compare(a: RoutePoint, b: RoutePoint): number; }
interface ComparerOptional { compare(a: number | undefined, b: number | undefined): number; }
class NumberComparer implements ComparerNumber { compare(a: number, b: number): number { seen.push(a, b); return a < b ? -1 : 1; } }
class StringComparer implements ComparerString { compare(a: string, b: string): number { seen.push(a, b); return a < b ? -1 : 1; } }
class PointComparer implements ComparerPoint { compare(a: RoutePoint, b: RoutePoint): number { seen.push(a, b); return a.id < b.id ? -1 : 1; } }
class OptionalComparer implements ComparerOptional { compare(a: number | undefined, b: number | undefined): number { seen.push(a, b); return a === undefined ? -1 : b === undefined ? 1 : a < b ? -1 : 1; } }
function chooseNumber(comparer: ComparerNumber, a: number, b: number): number { return comparer.compare(a, b) < 0 ? a : b; }
function chooseString(comparer: ComparerString, a: string, b: string): string { return comparer.compare(a, b) < 0 ? a : b; }
function choosePoint(comparer: ComparerPoint, a: RoutePoint, b: RoutePoint): RoutePoint { return comparer.compare(a, b) < 0 ? a : b; }
function chooseOptional(comparer: ComparerOptional, a: number | undefined, b: number | undefined): number | undefined { return comparer.compare(a, b) < 0 ? a : b; }
for (const n of [-0, NaN, 2.5]) {
  seen.length = 0;
  const word = String(n), point = { id: n }, other = { id: 5 };
  same(chooseNumber(new NumberComparer(), n, 5), n < 5 ? n : 5);
  same(chooseString(new StringComparer(), word, "m"), word < "m" ? word : "m");
  same(choosePoint(new PointComparer(), point, other), n < 5 ? point : other);
  same(chooseOptional(new OptionalComparer(), undefined, n), undefined);
  const expected: unknown[] = [n, 5, word, "m", point, other, undefined, n];
  same(seen.length, expected.length);
  for (let i = 0; i < expected.length; i++) same(seen[i], expected[i]);
}
