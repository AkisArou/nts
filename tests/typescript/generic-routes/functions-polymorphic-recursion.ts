/*---
description: Recursive calls change from numbers to strings to objects while each caller retains its own T-valued result.
features: [ts-generic-routes, ts-generic-route-functions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-arrays, ts-tuples, ts-unions, ts-generics]
---*/
// Descend cycles number to string to FunctionPoint at successive depths; an optional root joins the cycle, and node returns every retained caller value unchanged.
type FunctionPoint = { id: number };
let genericCalls = 0;
function descend<T>(value: T, depth: number, seed: number): T {
  genericCalls++;
  if (depth > 0 && depth % 3 === 0) same(descend<number>(seed, depth - 1, seed), seed);
  if (depth > 0 && depth % 3 === 2) { const text = "level:" + depth; same(descend<string>(text, depth - 1, seed), text); }
  if (depth > 0 && depth % 3 === 1) { const point: FunctionPoint = { id: seed }; same(descend<FunctionPoint>(point, depth - 1, seed), point); }
  return value;
}
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const rows: [number, number][] = [[-0, 2], [NaN, 5], [2.5, 8]];
for (const [n, depth] of rows) {
  genericCalls = 0;
  const text = "root:" + depth, point: FunctionPoint = { id: n };
  const optional: number | undefined = depth === 5 ? undefined : n;
  same(descend<number>(n, depth, n), n);
  same(descend<string>(text, depth - 1, n), text);
  same(descend<FunctionPoint>(point, depth + 1, n), point);
  same(descend<number | undefined>(optional, depth, n), optional);
  same(genericCalls, 4 * depth + 4);
}
