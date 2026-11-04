/*---
description: "toSpliced through a readonly array parameter preserves exact results and its receiver."
features: [ts-library-addition-routes, ts-library-addition-route-arrays, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined, ts-type-aliases, ts-interfaces, ts-objects, ts-to-primitive, ts-readonly, ts-spread, ts-conversions]
---*/
// toSpliced crosses a readonly array parameter; node clamps negative, fractional, signed-zero, NaN and infinite starts/counts, inserts several item kinds without conversion, densifies surviving holes, and preserves empty/singleton/nonempty receivers and identity.
const log: string[] = [];
interface Token { label: string; valueOf(): number; toString(): string; }
type Value = number | string | undefined | Token;
const token: Token = { label: "token", valueOf(): number { log.push("valueOf"); return 99; }, toString(): string { log.push("toString"); return "token"; } };
function check(source: readonly Value[], start: number, count: number, items: Value[], expected: Value[]): void {
  const before = source.slice(), keys = Object.keys(source); log.length = 0;
  log.push("copy");
  const result = source.toSpliced(start, count, ...items);
  const again = source;
  assert.compareArray(log, ["copy"]);
  assert.sameValue(again, source); assert.sameValue(result === source, false); assert.sameValue(Array.isArray(result), true);
  assert.compareArray(result, expected); assert.sameValue(result.length, expected.length);
  assert.compareArray(again, before); assert.sameValue(again.length, before.length); assert.compareArray(Object.keys(again), keys);
  for (let index = 0; index < result.length; index++) assert.sameValue(Object.hasOwn(result, index), true);
  result.push("copy-only"); assert.compareArray(again, before); assert.sameValue(again.length, before.length);
}
for (const seed of [2, 9]) for (const sparse of [false, true]) {
  const middle: Value = sparse ? undefined : -0, input: Value[] = [seed, middle, undefined, token]; if (sparse) delete input[1];
  const edits: [number, number, Value[], Value[]][] = [
    [-2, 10, [9], [seed, middle, 9]], [-0, 1, [token], [token, middle, undefined, token]], [-0.75, 0, [], [seed, middle, undefined, token]],
    [1.9, 1.9, ["x"], [seed, "x", undefined, token]], [-1.9, 0.9, [undefined], [seed, middle, undefined, undefined, token]],
    [-99, 2, [], [undefined, token]], [99, 99, ["x", "y"], [seed, middle, undefined, token, "x", "y"]], [2, -4, [9], [seed, middle, 9, undefined, token]],
    [NaN, NaN, [9], [9, seed, middle, undefined, token]], [Infinity, Infinity, [9], [seed, middle, undefined, token, 9]], [-Infinity, Infinity, [], []]
  ];
  for (const [start, count, items, expected] of edits) { check(input, start, count, items, expected); }
}
check([], -2, 10, [9], [9]);
check([token], -1, 1, [], []);
