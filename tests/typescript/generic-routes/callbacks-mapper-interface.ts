/*---
description: Four Mapper type pairs preserve exact arguments and result representations through a generic caller.
features: [ts-generic-routes, ts-generic-route-callbacks, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-interfaces, ts-class, ts-unions, ts-unknown, ts-generics]
---*/
// project uses number-to-string, string-to-number, object and optional mappers; node keeps each callback argument and mapped value.
type RoutePoint = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const seen: unknown[] = [];
interface Mapper<A, B> { map(value: A): B; }
class NumberText implements Mapper<number, string> { map(value: number): string { seen.push(value); return "n:" + String(value); } }
class TextLength implements Mapper<string, number> { map(value: string): number { seen.push(value); return value.length; } }
class PointKeep implements Mapper<RoutePoint, RoutePoint> { map(value: RoutePoint): RoutePoint { seen.push(value); return value; } }
class OptionalKeep implements Mapper<number | undefined, number | undefined> { map(value: number | undefined): number | undefined { seen.push(value); return value; } }
function project<A, B>(mapper: Mapper<A, B>, value: A): B { return mapper.map(value); }
for (const n of [-0, NaN, 2.5]) {
  seen.length = 0;
  const word = "v" + String(n), point = { id: n };
  same(project<number, string>(new NumberText(), n), "n:" + String(n));
  same(project<string, number>(new TextLength(), word), word.length);
  const mapped = project<RoutePoint, RoutePoint>(new PointKeep(), point); same(mapped, point); same(mapped.id, n);
  same(project<number | undefined, number | undefined>(new OptionalKeep(), n), n);
  same(project<number | undefined, number | undefined>(new OptionalKeep(), undefined), undefined);
  const expected: unknown[] = [n, word, point, n, undefined];
  same(seen.length, expected.length);
  for (let i = 0; i < expected.length; i++) same(seen[i], expected[i]);
}
