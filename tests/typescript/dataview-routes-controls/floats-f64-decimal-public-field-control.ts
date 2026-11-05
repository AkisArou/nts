/*---
description: "Float64 retains the original binary64 decimal values with all eight exact bytes through a public view field. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
const localFloat64: readonly [number, number, readonly number[]][] = [
  [0.1, 0.1, [63, 185, 153, 153, 153, 153, 153, 154]],
  [-0.1, -0.1, [191, 185, 153, 153, 153, 153, 153, 154]],
  [-0.3, -0.3, [191, 211, 51, 51, 51, 51, 51, 51]],
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
// Float64 retains the original binary64 decimal values with all eight exact bytes; route: a public view field. Node prints floats-f64-decimal-public-field:ok.
type View = number[];
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGetUint8(view, i); return result;
}
class FloatBox { view: View = localDataView(localArrayBuffer(10)); }
const rows: readonly [number, number, readonly number[]][] = [
  [0.1, 0.1, [63, 185, 153, 153, 153, 153, 153, 154]],
  [-0.1, -0.1, [191, 185, 153, 153, 153, 153, 153, 154]],
  [-0.3, -0.3, [191, 211, 51, 51, 51, 51, 51, 51]],
];
for (const [value, expected, encoded] of rows) for (const little of [false, true]) {
  const box: FloatBox = new FloatBox();
  localSetFloat64(box.view, 1, value, little);
  assert.sameValue(localGetFloat64(box.view, 1, little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 8; i++) bytes[1 + i] = encoded[little ? 7 - i : i];
  assert.compareArray(readBytes(box.view), bytes);
}
console.log("floats-f64-decimal-public-field:ok");
