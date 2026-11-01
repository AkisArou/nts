/*---
description: Control for callbacks-mapper-interface; expand each generic instantiation into its own non-generic declaration.
features: [ts-generic-routes, ts-generic-route-callbacks, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-typeof-operator, ts-interfaces, ts-class, ts-unions, ts-unknown]
---*/
// Write each used type argument as a separate non-generic specialization; keep the inputs, computations and assertions.
type RoutePoint = { id: number };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const seen: unknown[] = [];
interface MapperNumberText { map(value: number): string; }
interface MapperTextNumber { map(value: string): number; }
interface MapperPoint { map(value: RoutePoint): RoutePoint; }
interface MapperOptional { map(value: number | undefined): number | undefined; }
class NumberText implements MapperNumberText { map(value: number): string { seen.push(value); return "n:" + String(value); } }
class TextLength implements MapperTextNumber { map(value: string): number { seen.push(value); return value.length; } }
class PointKeep implements MapperPoint { map(value: RoutePoint): RoutePoint { seen.push(value); return value; } }
class OptionalKeep implements MapperOptional { map(value: number | undefined): number | undefined { seen.push(value); return value; } }
function projectNumberText(mapper: MapperNumberText, value: number): string { return mapper.map(value); }
function projectTextNumber(mapper: MapperTextNumber, value: string): number { return mapper.map(value); }
function projectPoint(mapper: MapperPoint, value: RoutePoint): RoutePoint { return mapper.map(value); }
function projectOptional(mapper: MapperOptional, value: number | undefined): number | undefined { return mapper.map(value); }
for (const n of [-0, NaN, 2.5]) {
  seen.length = 0;
  const word = "v" + String(n), point = { id: n };
  same(projectNumberText(new NumberText(), n), "n:" + String(n));
  same(projectTextNumber(new TextLength(), word), word.length);
  const mapped = projectPoint(new PointKeep(), point); same(mapped, point); same(mapped.id, n);
  same(projectOptional(new OptionalKeep(), n), n);
  same(projectOptional(new OptionalKeep(), undefined), undefined);
  const expected: unknown[] = [n, word, point, n, undefined];
  same(seen.length, expected.length);
  for (let i = 0; i < expected.length; i++) same(seen[i], expected[i]);
}
