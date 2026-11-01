/*---
description: "Nested object assignment reads typed branches once before writing existing leaf targets."
features: [ts-destructuring-routes, ts-destructuring-route-assignment, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-interfaces, ts-accessors, ts-destructuring]
---*/
// Nested AssignRoot/AssignBranch/AssignLeaf getters feed existing typed fields; node reads each level once and only defaults an undefined leaf.
type AssignValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: AssignValue[] = [0, -0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface AssignLeaf { value: AssignValue; }
interface AssignBranch { left: AssignValue; right: AssignLeaf; }
interface AssignRoot { outer: AssignBranch; }
for (const input of inputs) {
  const log: unknown[] = [], target: { left: AssignValue; right: AssignValue } = { left: "old-left", right: "old-right" };
  const leaf: AssignLeaf = { get value() { log.push("get", "value", input); return input; } };
  const branch: AssignBranch = { get left() { log.push("get", "left", marker); return marker; }, get right() { log.push("get", "right", leaf); return leaf; } };
  const source: AssignRoot = { get outer() { log.push("get", "outer", branch); return branch; } };
  function fallback(): AssignValue { log.push("default", replacement); return replacement; }
  ({ outer: { left: target.left, right: { value: target.right = fallback() } } } = source);
  same(target.left, marker); same(target.right, input === undefined ? replacement : input);
  const expected: unknown[] = ["get", "outer", branch, "get", "left", marker, "get", "right", leaf, "get", "value", input];
  if (input === undefined) expected.push("default", replacement); assert.compareArray(log, expected);
}
