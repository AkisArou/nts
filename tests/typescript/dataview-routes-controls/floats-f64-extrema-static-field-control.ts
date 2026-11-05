/*---
description: "Float64 retains finite extrema and minimal subnormals without losing their signs through a static view field. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-static]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
const localFloat64: readonly [number, number, readonly number[]][] = [
  [Number.MAX_VALUE, 1.7976931348623157e+308, [127, 239, 255, 255, 255, 255, 255, 255]],
  [-Number.MAX_VALUE, -1.7976931348623157e+308, [255, 239, 255, 255, 255, 255, 255, 255]],
  [Number.MIN_VALUE, 5e-324, [0, 0, 0, 0, 0, 0, 0, 1]],
  [-Number.MIN_VALUE, -5e-324, [128, 0, 0, 0, 0, 0, 0, 1]],
];
function localSetFloat64(bytes: number[], offset: number, value: number, little: boolean = false): void {
  for (const entry of localFloat64) if (Object.is(value, entry[0])) {
    for (let i = 0; i < 8; i++) bytes[offset + i] = entry[2][little ? 7 - i : i]; return;
  }
  throw new RangeError("unlisted float input");
}
function localGetFloat64(bytes: number[], offset: number, little: boolean = false): number {
  for (const entry of localFloat64) { let matches: boolean = true;
    for (let i = 0; i < 8; i++) if (bytes[offset + i] !== entry[2][little ? 7 - i : i]) matches = false;
    if (matches) return entry[1];
  }
  throw new RangeError("unlisted float bytes");
}
// Float64 retains finite extrema and minimal subnormals without losing their signs; route: a static view field. Node prints floats-f64-extrema-static-field:ok.
type View = number[];
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGetUint8(view, i); return result;
}
class FloatSlot { static view: View = localDataView(localArrayBuffer(10)); }
const rows: readonly [number, number, readonly number[]][] = [
  [Number.MAX_VALUE, 1.7976931348623157e+308, [127, 239, 255, 255, 255, 255, 255, 255]],
  [-Number.MAX_VALUE, -1.7976931348623157e+308, [255, 239, 255, 255, 255, 255, 255, 255]],
  [Number.MIN_VALUE, 5e-324, [0, 0, 0, 0, 0, 0, 0, 1]],
  [-Number.MIN_VALUE, -5e-324, [128, 0, 0, 0, 0, 0, 0, 1]],
];
for (const [value, expected, encoded] of rows) for (const little of [false, true]) {
  localSetFloat64(FloatSlot.view, 1, value, little);
  assert.sameValue(localGetFloat64(FloatSlot.view, 1, little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 8; i++) bytes[1 + i] = encoded[little ? 7 - i : i];
  assert.compareArray(readBytes(FloatSlot.view), bytes);
}
console.log("floats-f64-extrema-static-field:ok");
