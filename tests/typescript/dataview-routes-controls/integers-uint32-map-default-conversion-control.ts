/*---
description: "setUint32 uses big endian by default and wraps wide or negative values while truncating fractions and clearing nonfinite inputs. (control)"
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-map-set, ts-strings, ts-narrowing, ts-errors, ts-readonly, ts-tuples, ts-destructuring]
---*/

function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGet(bytes: number[], offset: number, width: number, signed: boolean, little = false): number {
  offset -= offset % 1; let value = 0; for (let i = 0; i < width; i++) value = value * 256 + bytes[offset + (little ? width - 1 - i : i)];
  return signed && value >= 256 ** width / 2 ? value - 256 ** width : value;
}
function localSet(bytes: number[], offset: number, value: number, width: number, little = false): void {
  offset -= offset % 1; const modulus = 256 ** width; if (value !== value || value === Infinity || value === -Infinity) value = 0;
  value -= value % 1; value = (value % modulus + modulus) % modulus;
  for (let i = 0; i < width; i++) { bytes[offset + (little ? i : width - 1 - i)] = value % 256; value = (value - value % 256) / 256; }
}
function localSetUint8(bytes: number[], offset: number, value: number): void { localSet(bytes, offset, value, 1); }
function localSetUint32(bytes: number[], offset: number, value: number, little = false): void { localSet(bytes, offset, value, 4, little); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
function localGetUint32(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 4, false, little); }
// setUint32 uses big endian by default and wraps wide or negative values while truncating fractions and clearing nonfinite inputs. Route: a View retrieved through guarded Map.get. Node prints integers-uint32-map-default-conversion:ok.
type View = number[];
const views: Map<string, View> = new Map([["word", localDataView(localArrayBuffer(4))]]);
const rows: readonly [number, number, readonly number[]][] = [
  [-4294967297, 4294967295, [255, 255, 255, 255]], [-1, 4294967295, [255, 255, 255, 255]],
  [2147483648, 2147483648, [128, 0, 0, 0]], [4294967295, 4294967295, [255, 255, 255, 255]],
  [4294967296, 0, [0, 0, 0, 0]], [4294967297, 1, [0, 0, 0, 1]],
  [-1.9, 4294967295, [255, 255, 255, 255]], [305419896.9, 305419896, [18, 52, 86, 120]], [-0.9, 0, [0, 0, 0, 0]],
  [NaN, 0, [0, 0, 0, 0]], [Infinity, 0, [0, 0, 0, 0]], [-Infinity, 0, [0, 0, 0, 0]]
];
for (const [value, expected, expectedBytes] of rows) {
  const view = views.get("word"); if (view === undefined) throw new Error("missing view");
  for (let i = 0; i < 4; i++) localSetUint8(view, i, 165);
  localSetUint32(view, 0, value);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(localGetUint32(view, 0), expected);
}
console.log("integers-uint32-map-default-conversion:ok");
