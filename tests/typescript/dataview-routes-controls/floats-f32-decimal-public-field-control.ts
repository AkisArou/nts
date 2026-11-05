/*---
description: "Float32 rounds decimal fractions to exact binary32 values and bytes through a public view field. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
const localFloat32: readonly [number, number, readonly number[]][] = [
  [0.1, 0.10000000149011612, [61, 204, 204, 205]],
  [-0.1, -0.10000000149011612, [189, 204, 204, 205]],
  [1 / 3, 0.3333333432674408, [62, 170, 170, 171]],
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
// Float32 rounds decimal fractions to exact binary32 values and bytes; route: a public view field. Node prints floats-f32-decimal-public-field:ok.
type View = number[];
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGetUint8(view, i); return result;
}
class FloatBox { view: View = localDataView(localArrayBuffer(6)); }
const rows: readonly [number, number, readonly number[]][] = [
  [0.1, 0.10000000149011612, [61, 204, 204, 205]],
  [-0.1, -0.10000000149011612, [189, 204, 204, 205]],
  [1 / 3, 0.3333333432674408, [62, 170, 170, 171]],
];
for (const [value, expected, encoded] of rows) for (const little of [false, true]) {
  const box: FloatBox = new FloatBox();
  localSetFloat32(box.view, 1, value, little);
  assert.sameValue(localGetFloat32(box.view, 1, little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 4; i++) bytes[1 + i] = encoded[little ? 3 - i : i];
  assert.compareArray(readBytes(box.view), bytes);
}
console.log("floats-f32-decimal-public-field:ok");
