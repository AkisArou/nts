/*---
description: "Float64 getters preserve zero and infinity signs from literal bytes with default or explicit order through a private view field. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-private-fields, ts-unions, ts-null-undefined]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
const localFloat64: readonly [number, number, readonly number[]][] = [
  [0, 0, [0, 0, 0, 0, 0, 0, 0, 0]],
  [-0, -0, [128, 0, 0, 0, 0, 0, 0, 0]],
  [Infinity, Infinity, [127, 240, 0, 0, 0, 0, 0, 0]],
  [-Infinity, -Infinity, [255, 240, 0, 0, 0, 0, 0, 0]],
];
function localGetFloat64(bytes: number[], offset: number, little: boolean = false): number {
  for (const entry of localFloat64) { let matches: boolean = true;
    for (let i = 0; i < 8; i++) if (bytes[offset + i] !== entry[2][little ? 7 - i : i]) matches = false;
    if (matches) return entry[1];
  }
  throw new RangeError("unlisted float bytes");
}
// Float64 getters preserve zero and infinity signs from literal bytes with default or explicit order; route: a private view field. Node prints floats-f64-get-specials-private-field:ok.
type View = number[];
function seeded(input: readonly number[]): View {
  const view: View = localDataView(localArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) localSetUint8(view, i, input[i]);
  return view;
}
class FloatBox {
  #view: View;
  constructor(input: readonly number[]) { this.#view = seeded(input); }
  read(little: boolean | undefined): number { return little === undefined ? localGetFloat64(this.#view, 0) : localGetFloat64(this.#view, 0, little); }
}
const rows: readonly [number, readonly number[]][] = [
  [0, [0, 0, 0, 0, 0, 0, 0, 0]],
  [-0, [128, 0, 0, 0, 0, 0, 0, 0]],
  [Infinity, [127, 240, 0, 0, 0, 0, 0, 0]],
  [-Infinity, [255, 240, 0, 0, 0, 0, 0, 0]],
];
for (const [expected, encoded] of rows) for (const little of [undefined, false, true]) {
  const input: number[] = [];
  for (let i = 0; i < 8; i++) input[i] = encoded[little ? 7 - i : i];
  const box: FloatBox = new FloatBox(input);
  assert.sameValue(box.read(little), expected);
}
console.log("floats-f64-get-specials-private-field:ok");
