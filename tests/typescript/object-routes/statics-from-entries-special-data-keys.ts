/*---
description: "Typed fromEntries defines special names as own data properties and never takes the inherited prototype setter path."
features: [ts-object-routes, ts-object-route-statics, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-record, ts-tuples, ts-literal-types, ts-computed-keys]
---*/
// String tuple entries include __proto__, constructor and toString through a Record return; node creates enumerable data, preserves the key position on replacement and returns the exact stored identities.
type StaticValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: StaticValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type SpecialRow = { kind: "empty" | "proto" | "mixed"; entries: [string, StaticValue][]; keys: string[]; values: StaticValue[] };
function inspect(input: StaticValue): void {
  const rows: SpecialRow[] = [
    { kind: "empty", entries: [], keys: [], values: [] },
    { kind: "proto", entries: [["__proto__", input]], keys: ["__proto__"], values: [input] },
    { kind: "mixed", entries: [["constructor", marker], ["__proto__", input], ["toString", undefined], ["__proto__", replacement]], keys: ["constructor", "__proto__", "toString"], values: [marker, replacement, undefined] }
  ];
  for (const row of rows) {
    const actual: Record<string, StaticValue> = Object.fromEntries<StaticValue>(row.entries), walked: string[] = [];
    for (const key in actual) walked.push(key);
    assert.compareArray(Object.keys(actual), row.keys); assert.compareArray(walked, row.keys);
    for (let i = 0; i < row.keys.length; i++) { same(Object.hasOwn(actual, row.keys[i]), true); same(actual[row.keys[i]], row.values[i]); }
    same(Object.hasOwn(actual, "__proto__"), row.kind !== "empty"); same(Object.hasOwn(actual, "id"), false);
  }
}
for (const input of inputs) inspect(input);
