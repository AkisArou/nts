/*---
description: "Uint32 explicit byte orders preserve large unsigned values and modulo results with exact independent bytes. (control)"
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-generics, ts-generic-constraints, ts-unions, ts-objects, ts-typeof-operator, ts-narrowing, ts-readonly, ts-tuples, ts-destructuring]
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
function localSetUint32(bytes: number[], offset: number, value: number, little = false): void { localSet(bytes, offset, value, 4, little); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
function localGetUint32(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 4, false, little); }
// Uint32 explicit byte orders preserve large unsigned values and modulo results with exact independent bytes. Route: a constrained byte-order helper at boolean and record type arguments. Node prints integers-uint32-generic-endian:ok.
type View = number[];
function check<T extends boolean | { little: boolean }>(input: T, value: number, expected: number, expectedBytes: readonly number[]): void {
  const little = typeof input === "boolean" ? input : input.little, view: View = localDataView(localArrayBuffer(4));
  localSetUint32(view, 0, value, little);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, expectedBytes); assert.sameValue(localGetUint32(view, 0, little), expected);
}
const rows: readonly [number, number, readonly number[], readonly number[]][] = [
  [2309737967, 2309737967, [137, 171, 205, 239], [239, 205, 171, 137]],
  [2147483649, 2147483649, [128, 0, 0, 1], [1, 0, 0, 128]],
  [-2, 4294967294, [255, 255, 255, 254], [254, 255, 255, 255]], [4294967297, 1, [0, 0, 0, 1], [1, 0, 0, 0]]
];
for (const [value, expected, big, little] of rows) for (const order of [false, true]) {
  check<boolean>(order, value, expected, order ? little : big);
  check<{ little: boolean }>({ little: order }, value, expected, order ? little : big);
}
console.log("integers-uint32-generic-endian:ok");
