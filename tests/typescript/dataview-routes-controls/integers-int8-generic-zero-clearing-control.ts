/*---
description: "setInt8 replaces a nonzero byte with positive zero for nonfinite values and values truncated to zero, preserving neighbors. (control)"
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-generics, ts-generic-constraints, ts-unions, ts-objects, ts-typeof-operator, ts-narrowing, ts-readonly]
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
function localSetInt8(bytes: number[], offset: number, value: number): void { localSet(bytes, offset, value, 1); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
function localGetInt8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, true); }
// setInt8 replaces a nonzero byte with positive zero for nonfinite values and values truncated to zero, preserving neighbors. Route: a constrained helper at number and boxed-record type arguments. Node prints integers-int8-generic-zero-clearing:ok.
type View = number[];
function check<T extends number | { value: number }>(input: T): void {
  const value = typeof input === "number" ? input : input.value, view: View = localDataView(localArrayBuffer(3));
  for (let i = 0; i < 3; i++) localSetUint8(view, i, 165);
  localSetInt8(view, 1, value);
  const bytes: number[] = []; for (let i = 0; i < 3; i++) bytes[i] = localGetUint8(view, i);
  assert.compareArray(bytes, [165, 0, 165]); assert.sameValue(localGetInt8(view, 1), 0);
}
const values: readonly number[] = [NaN, Infinity, -Infinity, -0, -0.9, 0.9];
for (const value of values) { check<number>(value); check<{ value: number }>({ value }); }
console.log("integers-int8-generic-zero-clearing:ok");
