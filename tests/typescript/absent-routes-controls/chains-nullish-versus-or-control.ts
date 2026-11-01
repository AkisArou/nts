/*---
description: Control for chains-nullish-versus-or; make missing values and presence explicit.
features: [ts-absent-routes, ts-absent-route-chains, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-interfaces]
---*/
// A required payload, presence flag and keys replace optional reads; explicit null checks and a conditional expression select each fallback.
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
interface ChoiceSlot { present: boolean; value: AbsentValue; keys: string[] }
function choose(slot: ChoiceSlot, fallback: AbsentValue): [AbsentValue, AbsentValue] {
  const current = slot.present ? slot.value : undefined;
  return [current === null || current === undefined ? fallback : current, current ? current : fallback];
}
for (const [value, encoded, nullish, falsey] of samples) for (const present of [false, true]) {
  const fallback = { tag: "fallback" }, slot: ChoiceSlot = { present, value, keys: present ? ["p"] : [] };
  const result = choose(slot, fallback);
  same(result[0], !present || nullish ? fallback : value); same(result[1], !present || falsey ? fallback : value);
  same(slot.present ? slot.value : undefined, present ? value : undefined);
  same(slot.keys.includes("p"), present); same(slot.present, present);
  assert.compareArray(slot.keys, present ? ["p"] : []);
  const json = slot.present && slot.value !== undefined ? '{"p":' + JSON.stringify(slot.value) + '}' : '{}';
  same(json, present && value !== undefined ? '{"p":' + encoded + '}' : '{}');
}
