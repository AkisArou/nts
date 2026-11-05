/*---
description: "Array.from copies exactly the yielded values and keeps earlier copies after captured bindings are reassigned."
features: [ts-array-method-routes, ts-array-method-route-construction, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-unions, ts-strings, ts-objects, ts-generators, ts-unknown, ts-closures]
---*/

// Array.from copies exactly the yielded values and keeps earlier copies after captured bindings are reassigned. Route: a typed generator reading captured let bindings. Node prints construction-from-generator-captured-let:ok.
type YieldValue = number | string | { id: number };
const marker = { id: 7 };
let current: YieldValue = marker, middle: YieldValue = "tail";
function* produce(count: number): Generator<YieldValue, void, unknown> {
  for (let index = 0; index < count; index++) yield index === 1 ? middle : current;
}
function read(count: number): YieldValue[] { return Array.from(produce(count)); }
const empty = read(0), single = read(1), before = read(4);
assert.compareArray(empty, []); assert.compareArray(single, [marker]);
assert.compareArray(before, [marker, "tail", marker, marker]); assert.sameValue(before[0] === marker, true);
current = -0; middle = NaN;
const after = read(4);
assert.compareArray(after, [-0, NaN, -0, -0]); assert.sameValue(Object.is(after[0], -0), true);
assert.compareArray(before, [marker, "tail", marker, marker]); assert.sameValue(before === after, false);
console.log("construction-from-generator-captured-let:ok");
