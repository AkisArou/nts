/*---
description: "Float32 rounds odd integers above two to the twenty fourth with ties to even through a private view field. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-private-fields]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
const localFloat32: readonly [number, number, readonly number[]][] = [
  [16777217, 16777216, [75, 128, 0, 0]],
  [16777219, 16777220, [75, 128, 0, 2]],
  [-16777217, -16777216, [203, 128, 0, 0]],
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
// Float32 rounds odd integers above two to the twenty fourth with ties to even; route: a private view field. Node prints floats-f32-integer-private-field:ok.
type View = number[];
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGetUint8(view, i); return result;
}
class FloatBox {
  #view: View = localDataView(localArrayBuffer(6));
  store(value: number, little: boolean): number { localSetFloat32(this.#view, 1, value, little); return localGetFloat32(this.#view, 1, little); }
  bytes(): number[] { return readBytes(this.#view); }
}
const rows: readonly [number, number, readonly number[]][] = [
  [16777217, 16777216, [75, 128, 0, 0]],
  [16777219, 16777220, [75, 128, 0, 2]],
  [-16777217, -16777216, [203, 128, 0, 0]],
];
for (const [value, expected, encoded] of rows) for (const little of [false, true]) {
  const box: FloatBox = new FloatBox();
  assert.sameValue(box.store(value, little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 4; i++) bytes[1 + i] = encoded[little ? 3 - i : i];
  assert.compareArray(box.bytes(), bytes);
}
console.log("floats-f32-integer-private-field:ok");
