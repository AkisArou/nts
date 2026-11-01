/*---
description: Control for chains-assignment-nullish; make missing values and presence explicit.
features: [ts-absent-routes, ts-absent-route-chains, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-interfaces, ts-function-types, ts-arrow-functions, ts-closures]
---*/
// A required payload, presence flag and recorded keys are updated by an explicit conditional; no logical assignment or absent field read remains.
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
interface AssignmentSlot { present: boolean; value: AbsentValue; keys: string[] }
function update(slot: AssignmentSlot, make: () => AbsentValue): AbsentValue {
  const current = slot.present ? slot.value : undefined;
  if (current === undefined || current === null) { slot.value = make(); if (!slot.present) slot.keys.push("p"); slot.present = true; return slot.value; }
  return current;
}
for (const [value, encoded, nullish, falsey] of samples) for (const present of [false, true]) {
  let calls = 0; const fallback = { tag: "fallback" }, slot: AssignmentSlot = { present, value, keys: present ? ["p"] : [] };
  const write = !present || nullish, expected = write ? fallback : present ? value : undefined, exists = present || write;
  const result = update(slot, () => { calls++; return fallback; }), current = slot.present ? slot.value : undefined;
  for (const actual of [result, current, current]) same(actual, expected);
  same(calls, write ? 1 : 0); same(slot.keys.includes("p"), exists); same(slot.present, exists);
  assert.compareArray(slot.keys, exists ? ["p"] : []);
  const json = slot.present && slot.value !== undefined ? '{"p":' + JSON.stringify(slot.value) + '}' : '{}';
  same(json, write ? '{"p":{"tag":"fallback"}}' : present && value !== undefined ? '{"p":' + encoded + '}' : '{}');
}
