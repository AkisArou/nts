/*---
description: "Control for assignment-object-existing-bindings; Object assignment updates existing union bindings and returns its original typed source."
features: [ts-destructuring-routes, ts-destructuring-route-assignment, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-interfaces, ts-accessors]
---*/
// Explicit reads keep the same inputs, protocol/default/getter log and observations. Read each selected property once, test undefined explicitly, and retain the original source as the expression result.
type AssignValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: AssignValue[] = [0, -0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface AssignSource { first: AssignValue; second: AssignValue; unused: AssignValue; }
for (const input of inputs) {
  const log: unknown[] = []; let left: AssignValue = "old-left", right: AssignValue = "old-right";
  function fallback(key: string): AssignValue { log.push("default", key, replacement); return replacement; }
  const source: AssignSource = { get first() { log.push("get", "first", input); return input; },
    get second() { log.push("get", "second", undefined); return undefined; }, get unused() { log.push("get", "unused", marker); return marker; } };
  const result = source; const first = source.first; left = first === undefined ? fallback("left") : first;
  const second = source.second; right = second === undefined ? fallback("right") : second;
  const wanted = input === undefined ? replacement : input;
  same(left, wanted); same(right, replacement); same(result, source);
  const expected: unknown[] = ["get", "first", input];
  if (input === undefined) expected.push("default", "left", replacement);
  expected.push("get", "second", undefined, "default", "right", replacement);
  assert.compareArray(log, expected);
}
