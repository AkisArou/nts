/*---
description: "Control for statics-assign-target-setter-order; Object.assign enumerates typed sources in key order and invokes each target setter after its source getter."
features: [ts-object-routes, ts-object-route-statics, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-mapped-types, ts-optional-properties, ts-accessors, ts-closures, ts-literal-types]
---*/
// Optional mapped AssignView sources include empty, numeric, getter, own-undefined and frozen shapes; node returns the same target and interleaves source reads with setters. The control writes the operation explicitly.
type StaticValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: StaticValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type AssignKey = "2" | "10" | "tail" | "maybe";
type AssignView = { [K in AssignKey]?: StaticValue };
function inspect(input: StaticValue): void {
  const log: unknown[] = [];
  const rows: { value: AssignView; keys: AssignKey[]; values: StaticValue[]; reads: boolean }[] = [
    { value: {}, keys: [], values: [], reads: false },
    { value: { "10": input, tail: replacement, "2": NaN }, keys: ["2", "10", "tail"], values: [NaN, input, replacement], reads: false },
    { value: { get tail() { log.push("source", "tail", input); return input; }, get "2"() { log.push("source", "2", -0); return -0; } }, keys: ["2", "tail"], values: [-0, input], reads: true },
    { value: { maybe: undefined }, keys: ["maybe"], values: [undefined], reads: false },
    { value: Object.freeze({ tail: input, "2": undefined }), keys: ["2", "tail"], values: [undefined, input], reads: false }
  ];
  for (const row of rows) {
    log.length = 0; const stored: { [K in AssignKey]: StaticValue } = { "2": marker, "10": marker, tail: marker, maybe: marker };
    const target = {
      get "2"(): StaticValue { log.push("read", "2", stored["2"]); return stored["2"]; }, set "2"(v: StaticValue) { log.push("set", "2", v); stored["2"] = v; },
      get "10"(): StaticValue { log.push("read", "10", stored["10"]); return stored["10"]; }, set "10"(v: StaticValue) { log.push("set", "10", v); stored["10"] = v; },
      get tail(): StaticValue { log.push("read", "tail", stored.tail); return stored.tail; }, set tail(v: StaticValue) { log.push("set", "tail", v); stored.tail = v; },
      get maybe(): StaticValue { log.push("read", "maybe", stored.maybe); return stored.maybe; }, set maybe(v: StaticValue) { log.push("set", "maybe", v); stored.maybe = v; }
    };
    for (const key of row.keys) target[key] = row.value[key];
    const actual = target, keys: AssignKey[] = ["2", "10", "tail", "maybe"], walked: string[] = [];
    for (const key in actual) walked.push(key);
    same(actual, target); assert.compareArray(Object.keys(actual), keys); assert.compareArray(walked, keys);
    const expected: unknown[] = [];
    for (let i = 0; i < row.keys.length; i++) { if (row.reads) expected.push("source", row.keys[i], row.values[i]); expected.push("set", row.keys[i], row.values[i]); }
    for (const key of keys) { const at = row.keys.indexOf(key), value = at < 0 ? marker : row.values[at]; same(actual[key], value); expected.push("read", key, value); }
    assert.compareArray(log, expected);
  }
}
for (const input of inputs) inspect(input);
