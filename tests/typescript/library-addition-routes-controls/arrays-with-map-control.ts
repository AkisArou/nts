/*---
description: "Control for arrays-with-map; with through a Map value narrowed after get preserves exact results and its receiver."
features: [ts-library-addition-routes, ts-library-addition-route-arrays, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-expressions, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined, ts-type-aliases, ts-interfaces, ts-objects, ts-to-primitive, ts-map-set, ts-narrowing, ts-errors, ts-conversions, ts-unknown, ts-instanceof]
---*/
// with crosses a Map value narrowed after get; node uses truncated relative indices including negative zero, rejects both out-of-bounds sides and empty receivers with RangeError, never coerces replacement objects, and makes fresh dense copies without changing source slots or length. The control uses older indexed loops in place of the new method.
const log: string[] = [];
interface Token { label: string; valueOf(): number; toString(): string; }
type Value = number | string | undefined | Token;
const token: Token = { label: "token", valueOf(): number { log.push("valueOf"); return 99; }, toString(): string { log.push("toString"); return "token"; } };
function check(route: Map<string, Value[]>, index: number, replacement: Value, target: number | undefined): void {
  const source = route.get("values"); if (source === undefined) throw new Error("missing array");
  const before = source.slice(), keys = Object.keys(source); log.length = 0;
  let output: Value[] | undefined; let caught: unknown;
  try {
    log.push("copy");
    const values = source, length = values.length;
    const relative = Math.trunc(index) || 0, at = relative < 0 ? length + relative : relative;
    if (at < 0 || at >= length) throw new RangeError();
    const result: Value[] = [];
    for (let k = 0; k < length; k++) result.push(k === at ? replacement : values[k]);
    output = result;
  } catch (error) { caught = error; }
  const again = route.get("values"); if (again === undefined) throw new Error("missing array");
  assert.compareArray(log, ["copy"]);
  assert.sameValue(caught instanceof RangeError, target === undefined); assert.sameValue(caught === undefined, target !== undefined);
  assert.sameValue(output === undefined, target === undefined); assert.sameValue(again, source);
  assert.compareArray(again, before); assert.sameValue(again.length, before.length); assert.compareArray(Object.keys(again), keys);
  if (output !== undefined) {
    const expected: Value[] = []; for (let k = 0; k < before.length; k++) expected.push(k === target ? replacement : before[k]);
    assert.sameValue(output === source, false); assert.sameValue(Array.isArray(output), true); assert.compareArray(output, expected); assert.sameValue(output.length, before.length);
    for (let k = 0; k < output.length; k++) assert.sameValue(Object.hasOwn(output, k), true);
    output.push("copy-only"); assert.compareArray(again, before); assert.sameValue(again.length, before.length);
  }
}
const indices: [number, number | undefined][] = [[-0, 0], [-0.75, 0], [NaN, 0], [1.9, 1], [-1, 3], [-1.9, 3], [-4, 0], [-4.9, 0], [3.9, 3], [4, undefined], [-5, undefined], [Infinity, undefined], [-Infinity, undefined]];
for (const seed of [2, 9]) for (const sparse of [false, true]) for (const replacement of [9, -0, undefined, token]) {
  const input: Value[] = [seed, -0, NaN, token]; if (sparse) delete input[1];
  for (const [index, target] of indices) { check(new Map<string, Value[]>([["values", input]]), index, replacement, target); }
  check(new Map<string, Value[]>([["values", []]]), -0, replacement, undefined);
}
