/*---
description: "The same seeded two bytes have independent signed and unsigned results in both byte orders, without a matching-width setter. (control)"
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
function localGetInt16(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 2, true, little); }
function localGetUint16(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 2, false, little); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
// The same seeded two bytes have independent signed and unsigned results in both byte orders, without a matching-width setter. Route: a View read through guarded Map.get. Node prints integers-int16-map-seeded-endian:ok.
type View = number[];
const rows: readonly [readonly number[], readonly number[]][] = [
  [[128, 1], [-32767, 384, 32769, 384]], [[1, 128], [384, -32767, 384, 32769]],
  [[255, 128], [-128, -32513, 65408, 33023]], [[127, 255], [32767, -129, 32767, 65407]]
];
for (const [seed, expected] of rows) {
  const view: View = localDataView(localArrayBuffer(2)); for (let i = 0; i < 2; i++) localSetUint8(view, i, seed[i]);
  const views: Map<string, View> = new Map([["word", view]]), stored = views.get("word");
  if (stored === undefined) throw new Error("missing word");
  const actual: number[] = [localGetInt16(stored, 0, false), localGetInt16(stored, 0, true), localGetUint16(stored, 0, false), localGetUint16(stored, 0, true)];
  assert.compareArray(actual, expected);
  const bytes: number[] = []; for (let i = 0; i < 2; i++) bytes[i] = localGetUint8(stored, i);
  assert.compareArray(bytes, seed);
}
console.log("integers-int16-map-seeded-endian:ok");
