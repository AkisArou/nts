/*---
description: "Float32 getters distinguish minimal subnormals and the subnormal to normal boundary from literal bytes through a private view field. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-private-fields]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
const localFloat32: readonly [number, number, readonly number[]][] = [
  [1.401298464324817e-45, 1.401298464324817e-45, [0, 0, 0, 1]],
  [-1.401298464324817e-45, -1.401298464324817e-45, [128, 0, 0, 1]],
  [1.1754942106924411e-38, 1.1754942106924411e-38, [0, 127, 255, 255]],
  [1.1754943508222875e-38, 1.1754943508222875e-38, [0, 128, 0, 0]],
];
function localGetFloat32(bytes: number[], offset: number, little: boolean = false): number {
  for (const entry of localFloat32) { let matches: boolean = true;
    for (let i = 0; i < 4; i++) if (bytes[offset + i] !== entry[2][little ? 3 - i : i]) matches = false;
    if (matches) return entry[1];
  }
  throw new RangeError("unlisted float bytes");
}
// Float32 getters distinguish minimal subnormals and the subnormal to normal boundary from literal bytes; route: a private view field. Node prints floats-f32-get-subnormal-private-field:ok.
type View = number[];
function seeded(input: readonly number[]): View {
  const view: View = localDataView(localArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) localSetUint8(view, i, input[i]);
  return view;
}
class FloatBox {
  #view: View;
  constructor(input: readonly number[]) { this.#view = seeded(input); }
  read(little: boolean): number { return localGetFloat32(this.#view, 0, little); }
}
const rows: readonly [number, readonly number[]][] = [
  [1.401298464324817e-45, [0, 0, 0, 1]],
  [-1.401298464324817e-45, [128, 0, 0, 1]],
  [1.1754942106924411e-38, [0, 127, 255, 255]],
  [1.1754943508222875e-38, [0, 128, 0, 0]],
];
for (const [expected, encoded] of rows) for (const little of [false, true]) {
  const input: number[] = [];
  for (let i = 0; i < 4; i++) input[i] = encoded[little ? 3 - i : i];
  const box: FloatBox = new FloatBox(input);
  assert.sameValue(box.read(little), expected);
}
console.log("floats-f32-get-subnormal-private-field:ok");
