/*---
description: Control for lookups-delete-versus-undefined; make missing values and presence explicit.
features: [ts-absent-routes, ts-absent-route-lookups, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-interfaces, ts-satisfies]
---*/
// Required payloads and presence flags are cleared explicitly, and recorded key lists model removal versus retention.
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
interface DeletableSlot { present: boolean; value: AbsentValue; keys: string[] }
for (const [value, encoded] of samples) for (const present of [false, true]) {
  const removed: DeletableSlot = { present, value, keys: present ? ["p"] : [] }, cleared: DeletableSlot = { present, value, keys: present ? ["p"] : [] };
  for (const slot of [removed, cleared]) {
    same(slot.present ? slot.value : undefined, present ? value : undefined); same(slot.keys.includes("p"), present); same(slot.present, present);
    assert.compareArray(slot.keys, present ? ["p"] : []);
    const json = slot.present && slot.value !== undefined ? '{"p":' + JSON.stringify(slot.value) + '}' : '{}';
    same(json, present && value !== undefined ? '{"p":' + encoded + '}' : '{}');
  }
  removed.present = false; removed.value = undefined; removed.keys = []; cleared.present = true; cleared.value = undefined; cleared.keys = ["p"];
  for (const [slot, exists] of [[removed, false], [cleared, true]] satisfies [DeletableSlot, boolean][]) {
    const p = slot.present ? slot.value : undefined;
    for (const actual of [p, p, p]) same(actual, undefined);
    same(slot.keys.includes("p"), exists); same(slot.present, exists);
    assert.compareArray(slot.keys, exists ? ["p"] : []);
    const json = slot.present && slot.value !== undefined ? '{"p":' + JSON.stringify(slot.value) + '}' : '{}'; same(json, '{}');
  }
}
