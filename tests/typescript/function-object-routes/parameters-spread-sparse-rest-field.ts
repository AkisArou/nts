/*---
description: A rest-only function field receives dense undefined entries when a sparse source array is spread, without changing the source holes.
features: [ts-function-object-route-defaults-rest, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-interfaces, ts-rest-parameters, ts-spread, ts-null-undefined, ts-objects]
---*/
// An interface field carries rest-only functions; node turns source holes into present undefined slots in a new argument array.
type ParamValue = number | string | boolean | null | undefined | { mark: number };

type ParamReader = (...values: ParamValue[]) => ParamValue[];
interface ParamHolder { reader: ParamReader; }
function declared(...values: ParamValue[]): ParamValue[] { return values; }
const expression = function (...values: ParamValue[]): ParamValue[] { return values; };
const readers: ParamReader[] = [declared, expression];
function invoke(holder: ParamHolder, input: ParamValue[], count: number): ParamValue[] { return holder.reader(...input); }
const identity = { mark: 23 };
const rows: { input: ParamValue[]; count: number; keys: string[]; expected: ParamValue[]; denseKeys: string[] }[] = [
  { input: [], count: 0, keys: [], expected: [], denseKeys: [] },
  { input: [undefined], count: 1, keys: ["0"], expected: [undefined], denseKeys: ["0"] },
  { input: new Array<ParamValue>(3), count: 3, keys: [], expected: [undefined, undefined, undefined], denseKeys: ["0", "1", "2"] },
  { input: [, undefined, , -0, NaN], count: 5, keys: ["1", "3", "4"], expected: [undefined, undefined, undefined, -0, NaN], denseKeys: ["0", "1", "2", "3", "4"] },
  { input: [identity, , null], count: 3, keys: ["0", "2"], expected: [identity, undefined, null], denseKeys: ["0", "1", "2"] }
];
for (const reader of readers) for (const row of rows) {
  const original = row.input.slice(), holder: ParamHolder = { reader }, actual = invoke(holder, row.input, row.count);
  assert.compareArray(actual, row.expected); assert.compareArray(Object.keys(actual), row.denseKeys);
  assert.sameValue(actual === row.input, false); assert.compareArray(Object.keys(row.input), row.keys);
  actual[0] = "private"; assert.sameValue(actual[0], "private"); assert.compareArray(row.input, original); assert.compareArray(Object.keys(row.input), row.keys);
  assert.compareArray(invoke(holder, row.input, row.count), row.expected);
}
