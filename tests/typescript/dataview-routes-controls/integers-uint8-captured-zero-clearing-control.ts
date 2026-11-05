/*---
description: "setUint8 replaces an existing byte with positive zero for nonfinite and subunit values while leaving neighbors unchanged. (control)"
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-closures, ts-arrow-functions, ts-readonly]
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
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
// setUint8 replaces an existing byte with positive zero for nonfinite and subunit values while leaving neighbors unchanged. Route: a reassigned let captured by a writer closure. Node prints integers-uint8-captured-zero-clearing:ok.
type View = number[];
const view: View = localDataView(localArrayBuffer(3));
for (let i = 0; i < 3; i++) localSetUint8(view, i, 90);
let value = 7;
const write: () => void = () => { localSetUint8(view, 1, value); };
const values: readonly number[] = [NaN, Infinity, -Infinity, -0, -0.9, 0.9];
for (const next of values) {
  value = next; localSetUint8(view, 1, 255); write();
  const bytes: number[] = []; for (let i = 0; i < 3; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, [90, 0, 90]); assert.sameValue(localGetUint8(view, 1), 0);
}
console.log("integers-uint8-captured-zero-clearing:ok");
