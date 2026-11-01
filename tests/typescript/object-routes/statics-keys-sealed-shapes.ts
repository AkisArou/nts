/*---
description: "Key enumeration preserves mixed and optional shapes after Object.seal without invoking getters."
features: [ts-object-routes, ts-object-route-statics, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-index-signatures, ts-accessors, ts-closures]
---*/
// Empty, mixed-index, getter and optional-presence KeyTable objects cross seal; node returns exact keys and for-in order, leaving getters untouched until the explicit value reads.
type StaticValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: StaticValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type KeyTable = { [key: string]: StaticValue };
function inspect(input: StaticValue): void {
  const log: unknown[] = [];
  const rows: { value: KeyTable; keys: string[]; values: StaticValue[]; reads: boolean }[] = [
    { value: {}, keys: [], values: [], reads: false },
    { value: { "10": input, tail: marker, "2": NaN, "01": undefined }, keys: ["2", "10", "tail", "01"], values: [NaN, input, marker, undefined], reads: false },
    { value: { get tail() { log.push("get", "tail", input); return input; }, get "2"() { log.push("get", "2", -0); return -0; } }, keys: ["2", "tail"], values: [-0, input], reads: true },
    { value: { value: input }, keys: ["value"], values: [input], reads: false },
    { value: { value: input, maybe: undefined }, keys: ["value", "maybe"], values: [input, undefined], reads: false }
  ];
  for (const row of rows) {
    log.length = 0; const solid = Object.seal(row.value), keys = Object.keys(solid), walked: string[] = [];
    for (const key in solid) walked.push(key);
    log.push("enumerated", keys.length); same(Object.isSealed(solid), true); same(solid, row.value);
    assert.compareArray(keys, row.keys); assert.compareArray(walked, row.keys);
    const expected: unknown[] = ["enumerated", row.keys.length];
    for (let i = 0; i < row.keys.length; i++) { same(solid[row.keys[i]], row.values[i]); if (row.reads) expected.push("get", row.keys[i], row.values[i]); }
    same(Object.hasOwn(solid, "maybe"), row.keys.includes("maybe")); assert.compareArray(log, expected);
  }
}
for (const input of inputs) inspect(input);
