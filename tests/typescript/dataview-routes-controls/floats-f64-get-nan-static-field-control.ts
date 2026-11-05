/*---
description: "Float64 getters classify distinct signed NaN inputs without asserting an encoding through a reassigned static view field. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-static]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
const localFloat64: readonly [number, number, readonly number[]][] = [
  [NaN, NaN, [127, 248, 0, 0, 0, 0, 0, 0]],
  [NaN, NaN, [127, 240, 0, 0, 0, 0, 0, 1]],
  [NaN, NaN, [255, 248, 0, 0, 0, 0, 0, 7]],
];
function localGetFloat64(bytes: number[], offset: number, little: boolean = false): number {
  for (const entry of localFloat64) { let matches: boolean = true;
    for (let i = 0; i < 8; i++) if (bytes[offset + i] !== entry[2][little ? 7 - i : i]) matches = false;
    if (matches) return entry[1];
  }
  throw new RangeError("unlisted float bytes");
}
// Float64 getters classify distinct signed NaN inputs without asserting an encoding; route: a reassigned static view field. Node prints floats-f64-get-nan-static-field:ok.
type View = number[];
function seeded(input: readonly number[]): View {
  const view: View = localDataView(localArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) localSetUint8(view, i, input[i]);
  return view;
}
class FloatSlot {
  static view: View = localDataView(localArrayBuffer(8));
  static read(little: boolean): number { return localGetFloat64(FloatSlot.view, 0, little); }
}
const patterns: readonly (readonly number[])[] = [
  [127, 248, 0, 0, 0, 0, 0, 0], [127, 240, 0, 0, 0, 0, 0, 1], [255, 248, 0, 0, 0, 0, 0, 7],
];
for (const encoded of patterns) for (const little of [false, true]) {
  const input: number[] = [];
  for (let i = 0; i < 8; i++) input[i] = encoded[little ? 7 - i : i];
  FloatSlot.view = seeded(input);
  assert.sameValue(Number.isNaN(FloatSlot.read(little)), true);
}
console.log("floats-f64-get-nan-static-field:ok");
