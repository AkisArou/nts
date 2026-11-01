/*---
description: Control for functions-polymorphic-recursion; use separate non-generic functions for each type argument.
features: [ts-generic-routes, ts-generic-route-functions, ts-functions, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-objects, ts-null-undefined, ts-arrays, ts-tuples, ts-unions]
---*/
// Write every specialization as its own non-generic function; keep the values, operations and assertions.
type FunctionPoint = { id: number };
let genericCalls = 0;
function descendNumber(value: number, depth: number, seed: number): number {
  genericCalls++;
  if (depth > 0 && depth % 3 === 0) same(descendNumber(seed, depth - 1, seed), seed);
  if (depth > 0 && depth % 3 === 2) { const text = "level:" + depth; same(descendString(text, depth - 1, seed), text); }
  if (depth > 0 && depth % 3 === 1) { const point: FunctionPoint = { id: seed }; same(descendPoint(point, depth - 1, seed), point); }
  return value;
}
function descendString(value: string, depth: number, seed: number): string {
  genericCalls++;
  if (depth > 0 && depth % 3 === 0) same(descendNumber(seed, depth - 1, seed), seed);
  if (depth > 0 && depth % 3 === 2) { const text = "level:" + depth; same(descendString(text, depth - 1, seed), text); }
  if (depth > 0 && depth % 3 === 1) { const point: FunctionPoint = { id: seed }; same(descendPoint(point, depth - 1, seed), point); }
  return value;
}
function descendPoint(value: FunctionPoint, depth: number, seed: number): FunctionPoint {
  genericCalls++;
  if (depth > 0 && depth % 3 === 0) same(descendNumber(seed, depth - 1, seed), seed);
  if (depth > 0 && depth % 3 === 2) { const text = "level:" + depth; same(descendString(text, depth - 1, seed), text); }
  if (depth > 0 && depth % 3 === 1) { const point: FunctionPoint = { id: seed }; same(descendPoint(point, depth - 1, seed), point); }
  return value;
}
function descendOptional(value: number | undefined, depth: number, seed: number): number | undefined {
  genericCalls++;
  if (depth > 0 && depth % 3 === 0) same(descendNumber(seed, depth - 1, seed), seed);
  if (depth > 0 && depth % 3 === 2) { const text = "level:" + depth; same(descendString(text, depth - 1, seed), text); }
  if (depth > 0 && depth % 3 === 1) { const point: FunctionPoint = { id: seed }; same(descendPoint(point, depth - 1, seed), point); }
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
  same(descendNumber(n, depth, n), n);
  same(descendString(text, depth - 1, n), text);
  same(descendPoint(point, depth + 1, n), point);
  same(descendOptional(optional, depth, n), optional);
  same(genericCalls, 4 * depth + 4);
}
