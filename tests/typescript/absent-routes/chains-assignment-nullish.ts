/*---
description: ??= on an optional typed field changes presence only when its value selects the right operand.
features: [ts-absent-routes, ts-absent-route-chains, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-interfaces, ts-function-types, ts-arrow-functions, ts-closures, ts-optional-properties]
---*/
// An optional union field starts absent or present; node applies ??=, preserving skipped payloads and calling the writer only when selected.
type AbsentValue = number | string | boolean | null | undefined | { tag: string };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const point = { tag: "point" };
const samples: [AbsentValue, string, boolean, boolean][] = [
  [undefined, "null", true, true], [null, "null", true, true], [0, "0", false, true], [-0, "0", false, true],
  ["", '""', false, true], [NaN, "null", false, true], [false, "false", false, true],
  [point, '{"tag":"point"}', false, false], [7, "7", false, false], ["live", '"live"', false, false], [true, "true", false, false]
];
interface AssignmentSlot { p?: AbsentValue }
function update(slot: AssignmentSlot, make: () => AbsentValue): AbsentValue { return slot.p ??= make(); }
for (const [value, encoded, nullish, falsey] of samples) for (const present of [false, true]) {
  let calls = 0; const fallback = { tag: "fallback" }, slot: AssignmentSlot = present ? { p: value } : {};
  const write = !present || nullish, expected = write ? fallback : present ? value : undefined, exists = present || write;
  const result = update(slot, () => { calls++; return fallback; });
  for (const actual of [result, slot.p, slot["p"]]) same(actual, expected);
  same(calls, write ? 1 : 0); same("p" in slot, exists); same(Object.hasOwn(slot, "p"), exists);
  assert.compareArray(Object.keys(slot), exists ? ["p"] : []);
  same(JSON.stringify(slot), write ? '{"p":{"tag":"fallback"}}' : present && value !== undefined ? '{"p":' + encoded + '}' : '{}');
}
