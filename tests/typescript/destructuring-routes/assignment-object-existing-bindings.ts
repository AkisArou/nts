/*---
description: "Object assignment updates existing union bindings and returns its original typed source."
features: [ts-destructuring-routes, ts-destructuring-route-assignment, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-interfaces, ts-accessors, ts-destructuring]
---*/
// An AssignSource object assigns existing union bindings with defaults; node reads each selected getter once and returns the source identity.
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
  const result = ({ first: left = fallback("left"), second: right = fallback("right") } = source);
  const wanted = input === undefined ? replacement : input;
  same(left, wanted); same(right, replacement); same(result, source);
  const expected: unknown[] = ["get", "first", input];
  if (input === undefined) expected.push("default", "left", replacement);
  expected.push("get", "second", undefined, "default", "right", replacement);
  assert.compareArray(log, expected);
}
