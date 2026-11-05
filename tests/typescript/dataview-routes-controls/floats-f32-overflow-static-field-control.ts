/*---
description: "Float32 overflows with the original sign while the largest finite value remains finite through a static view field. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-static]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
const localFloat32: readonly [number, number, readonly number[]][] = [
  [1e40, Infinity, [127, 128, 0, 0]],
  [-1e40, -Infinity, [255, 128, 0, 0]],
  [3.4028234663852886e38, 3.4028234663852886e+38, [127, 127, 255, 255]],
  [-3.4028234663852886e38, -3.4028234663852886e+38, [255, 127, 255, 255]],
];
function localSetFloat32(bytes: number[], offset: number, value: number, little: boolean = false): void {
  for (const entry of localFloat32) if (Object.is(value, entry[0])) {
    for (let i = 0; i < 4; i++) bytes[offset + i] = entry[2][little ? 3 - i : i]; return;
  }
  throw new RangeError("unlisted float input");
}
function localGetFloat32(bytes: number[], offset: number, little: boolean = false): number {
  for (const entry of localFloat32) { let matches: boolean = true;
    for (let i = 0; i < 4; i++) if (bytes[offset + i] !== entry[2][little ? 3 - i : i]) matches = false;
    if (matches) return entry[1];
  }
  throw new RangeError("unlisted float bytes");
}
// Float32 overflows with the original sign while the largest finite value remains finite; route: a static view field. Node prints floats-f32-overflow-static-field:ok.
type View = number[];
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGetUint8(view, i); return result;
}
class FloatSlot { static view: View = localDataView(localArrayBuffer(6)); }
const rows: readonly [number, number, readonly number[]][] = [
  [1e40, Infinity, [127, 128, 0, 0]],
  [-1e40, -Infinity, [255, 128, 0, 0]],
  [3.4028234663852886e38, 3.4028234663852886e+38, [127, 127, 255, 255]],
  [-3.4028234663852886e38, -3.4028234663852886e+38, [255, 127, 255, 255]],
];
for (const [value, expected, encoded] of rows) for (const little of [false, true]) {
  localSetFloat32(FloatSlot.view, 1, value, little);
  assert.sameValue(localGetFloat32(FloatSlot.view, 1, little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 4; i++) bytes[1 + i] = encoded[little ? 3 - i : i];
  assert.compareArray(readBytes(FloatSlot.view), bytes);
}
console.log("floats-f32-overflow-static-field:ok");
