/*---
description: "Int32 explicit byte orders keep signed values after wrapping and produce exact asymmetric bytes in either branch. (control)"
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-unions, ts-narrowing, ts-objects, ts-strings, ts-readonly, ts-tuples, ts-destructuring]
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
function localSetInt32(bytes: number[], offset: number, value: number, little = false): void { localSet(bytes, offset, value, 4, little); }
function localGetInt32(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 4, true, little); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
// Int32 explicit byte orders keep signed values after wrapping and produce exact asymmetric bytes in either branch. Route: a discriminated union with distinct View fields. Node prints integers-int32-union-endian:ok.
type View = number[];
type OrderView = { kind: "big"; big: View } | { kind: "little"; little: View };
function check(job: OrderView, value: number, expected: number, expectedBytes: readonly number[]): void {
  const view = job.kind === "big" ? job.big : job.little;
  if (job.kind === "big") localSetInt32(view, 0, value, false); else localSetInt32(view, 0, value, true);
  const result = job.kind === "big" ? localGetInt32(view, 0, false) : localGetInt32(view, 0, true);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = localGetUint8(view, i);
  assert.sameValue(result, expected); assert.compareArray(bytes, expectedBytes);
}
const rows: readonly [number, number, readonly number[], readonly number[]][] = [
  [305419896, 305419896, [18, 52, 86, 120], [120, 86, 52, 18]],
  [-2147483647, -2147483647, [128, 0, 0, 1], [1, 0, 0, 128]],
  [2147483648, -2147483648, [128, 0, 0, 0], [0, 0, 0, 128]], [4294967297, 1, [0, 0, 0, 1], [1, 0, 0, 0]]
];
for (const [value, expected, big, little] of rows) for (const order of [false, true]) {
  const view: View = localDataView(localArrayBuffer(4));
  check(order ? { kind: "little", little: view } : { kind: "big", big: view }, value, expected, order ? little : big);
}
console.log("integers-int32-union-endian:ok");
