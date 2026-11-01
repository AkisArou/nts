/*---
description: A typed optional field keeps falsey values under nullish coalescing but selects the fallback under logical OR.
features: [ts-absent-routes, ts-absent-route-chains, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-numbers, ts-strings, ts-unions, ts-objects, ts-arrays, ts-tuples, ts-type-aliases, ts-destructuring, ts-unknown, ts-expressions, ts-interfaces, ts-optional-properties]
---*/
// An optional union field is absent, undefined or a concrete value; node applies ?? only to nullish reads and || to every falsey read.
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
interface ChoiceSlot { p?: AbsentValue }
function choose(slot: ChoiceSlot, fallback: AbsentValue): [AbsentValue, AbsentValue] { return [slot.p ?? fallback, slot.p || fallback]; }
for (const [value, encoded, nullish, falsey] of samples) for (const present of [false, true]) {
  const fallback = { tag: "fallback" }, slot: ChoiceSlot = present ? { p: value } : {};
  const result = choose(slot, fallback);
  same(result[0], !present || nullish ? fallback : value); same(result[1], !present || falsey ? fallback : value);
  same(slot.p, present ? value : undefined);
  same("p" in slot, present); same(Object.hasOwn(slot, "p"), present);
  assert.compareArray(Object.keys(slot), present ? ["p"] : []);
  same(JSON.stringify(slot), present && value !== undefined ? '{"p":' + encoded + '}' : '{}');
}
