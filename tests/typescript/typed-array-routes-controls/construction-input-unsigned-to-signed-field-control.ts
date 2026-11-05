/*---
description: "Constructing signed bytes from unsigned bytes converts each value into independent storage. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-class, ts-class-fields, ts-tuples, ts-destructuring]
---*/

function localInteger(value: number, width: number, signed: boolean): number { if (!Number.isFinite(value)) return 0; const modulus = 2 ** width, n = (Math.trunc(value) % modulus + modulus) % modulus; return signed && n >= modulus / 2 ? n - modulus : n; }
function localUint8Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localInt8Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = localInteger(values[i], 8, true); return result; }
function localBuffer<T>(values: T[]): T[] { return values; }
// Constructing signed bytes from unsigned bytes converts each value into independent storage. Route: a public unsigned-byte source field.
// Node prints construction-input-unsigned-to-signed-field:ok.
type InputSamples = number[]; type OutputSamples = number[];
class InputStore { data: InputSamples; constructor(values: readonly number[]) { this.data = localUint8Array(values); } }
const rows: readonly [readonly number[], readonly number[]][] = [[[200, 127, 128, 255], [-56, 127, -128, -1]], [[0, 1, 254, 129], [0, 1, -2, -127]]];
for (const [values, expected] of rows) {
  const holder = new InputStore(values), source = holder.data, result: OutputSamples = localInt8Array(holder.data), actual: number[] = [];
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.sameValue(localBuffer(result) === localBuffer(source), false);
  source[0] = 42; result[1] = -9;
  assert.sameValue(result[0], expected[0]); assert.sameValue(source[1], values[1]);
}
console.log("construction-input-unsigned-to-signed-field:ok");
