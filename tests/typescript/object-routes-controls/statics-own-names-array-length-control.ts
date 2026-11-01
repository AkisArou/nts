/*---
description: "Control for statics-own-names-array-length; Own property names through a generic array view include nonenumerable length while enumeration omits length and holes."
features: [ts-object-routes, ts-object-route-statics, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-generics, ts-intersections, ts-optional-properties]
---*/
// Empty, dense and sparse NamedArray objects cross a generic names reader with optional own tail; node returns indices before native length and tail, preserving absent slots versus own undefined. The control writes the operation explicitly.
type StaticValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: StaticValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type NamedArray = StaticValue[] & { tail?: StaticValue };
function namesOf<T extends NamedArray>(value: T, explicitNames: string[]): string[] { return explicitNames.slice(); }
function inspect(input: StaticValue): void {
  const empty: NamedArray = [], dense: NamedArray = [input, undefined], sparse: NamedArray = [];
  dense.tail = marker; sparse.length = 3; sparse[1] = input; sparse.tail = undefined;
  const rows: { value: NamedArray; names: string[]; keys: string[]; values: StaticValue[]; length: number }[] = [
    { value: empty, names: ["length"], keys: [], values: [], length: 0 },
    { value: dense, names: ["0", "1", "length", "tail"], keys: ["0", "1", "tail"], values: [input, undefined, marker], length: 2 },
    { value: sparse, names: ["1", "length", "tail"], keys: ["1", "tail"], values: [input, undefined], length: 3 }
  ];
  for (const row of rows) {
    const names = namesOf(row.value, row.names), walked: string[] = [];
    for (const key in row.value) walked.push(key);
    assert.compareArray(names, row.names); assert.compareArray(Object.keys(row.value), row.keys); assert.compareArray(walked, row.keys);
    same(row.value.length, row.length); same(Object.hasOwn(row.value, "length"), true); same(Object.hasOwn(row.value, "tail"), row.keys.includes("tail"));
    for (let i = 0; i < row.keys.length; i++) { const key = row.keys[i]; same(key === "tail" ? row.value.tail : row.value[Number(key)], row.values[i]); }
  }
}
for (const input of inputs) inspect(input);
