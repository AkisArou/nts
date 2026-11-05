/*---
description: "Constructing unsigned bytes from signed words wraps values and makes an independent copy. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-class, ts-class-fields, ts-private-fields, ts-tuples, ts-destructuring]
---*/

function localInteger(value: number, width: number, signed: boolean): number { if (!Number.isFinite(value)) return 0; const modulus = 2 ** width, n = (Math.trunc(value) % modulus + modulus) % modulus; return signed && n >= modulus / 2 ? n - modulus : n; }
function localInt16Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localUint8Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = localInteger(values[i], 8, false); return result; }
function localBuffer<T>(values: T[]): T[] { return values; }
// Constructing unsigned bytes from signed words wraps values and makes an independent copy. Route: a private signed-word source used by a declared copy method.
// Node prints construction-input-word-to-byte-private:ok.
type InputSamples = number[]; type OutputSamples = number[];
class InputStore {
  #data: InputSamples; constructor(values: readonly number[]) { this.#data = localInt16Array(values); }
  copy(): OutputSamples { return localUint8Array(this.#data); }
  source(): InputSamples { return this.#data; }
}
const rows: readonly [readonly number[], readonly number[]][] = [[[-1, 256, 32767, -32768], [255, 0, 255, 0]], [[257, -257, 0, 128], [1, 255, 0, 128]]];
for (const [values, expected] of rows) {
  const holder = new InputStore(values), source = holder.source(), result = holder.copy(), actual: number[] = [];
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.sameValue(localBuffer(result) === localBuffer(source), false);
  source[0] = 13; result[1] = 17;
  assert.sameValue(result[0], expected[0]); assert.sameValue(source[1], values[1]);
}
console.log("construction-input-word-to-byte-private:ok");
