/*---
description: Deleting an optional interface field differs from writing undefined after the same starting values.
features: [ts-absent-routes, ts-absent-route-lookups, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-interfaces, ts-satisfies, ts-optional-properties]
---*/
// Two optional interface fields start absent or with a payload; node reads undefined after delete and assignment but retains only the assigned key.
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
interface DeletableSlot { p?: AbsentValue }
for (const [value, encoded] of samples) for (const present of [false, true]) {
  const removed: DeletableSlot = present ? { p: value } : {}, cleared: DeletableSlot = present ? { p: value } : {};
  for (const slot of [removed, cleared]) {
    same(slot.p, present ? value : undefined); same("p" in slot, present); same(Object.hasOwn(slot, "p"), present);
    assert.compareArray(Object.keys(slot), present ? ["p"] : []);
    same(JSON.stringify(slot), present && value !== undefined ? '{"p":' + encoded + '}' : '{}');
  }
  delete removed.p; cleared.p = undefined;
  for (const [slot, exists] of [[removed, false], [cleared, true]] satisfies [DeletableSlot, boolean][]) {
    const { p } = slot;
    for (const actual of [slot.p, slot["p"], p]) same(actual, undefined);
    same("p" in slot, exists); same(Object.hasOwn(slot, "p"), exists);
    assert.compareArray(Object.keys(slot), exists ? ["p"] : []); same(JSON.stringify(slot), '{}');
  }
}
