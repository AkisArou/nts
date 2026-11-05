/*---
description: "Float32 getters retain both zero signs and infinity signs from independent literal bytes through a destructured readonly view and endian tuple. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
const localFloat32: readonly [number, number, readonly number[]][] = [
  [0, 0, [0, 0, 0, 0]],
  [-0, -0, [128, 0, 0, 0]],
  [Infinity, Infinity, [127, 128, 0, 0]],
  [-Infinity, -Infinity, [255, 128, 0, 0]],
];
function localGetFloat32(bytes: number[], offset: number, little: boolean = false): number {
  for (const entry of localFloat32) { let matches: boolean = true;
    for (let i = 0; i < 4; i++) if (bytes[offset + i] !== entry[2][little ? 3 - i : i]) matches = false;
    if (matches) return entry[1];
  }
  throw new RangeError("unlisted float bytes");
}
// Float32 getters retain both zero signs and infinity signs from independent literal bytes; route: a destructured readonly view and endian tuple. Node prints floats-f32-get-specials-tuple:ok.
type View = number[];
function seeded(input: readonly number[]): View {
  const view: View = localDataView(localArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) localSetUint8(view, i, input[i]);
  return view;
}
const rows: readonly [number, readonly number[]][] = [
  [0, [0, 0, 0, 0]],
  [-0, [128, 0, 0, 0]],
  [Infinity, [127, 128, 0, 0]],
  [-Infinity, [255, 128, 0, 0]],
];
for (const [expected, encoded] of rows) for (const little of [false, true]) {
  const input: number[] = [];
  for (let i = 0; i < 4; i++) input[i] = encoded[little ? 3 - i : i];
  const [selected, order]: readonly [View, boolean] = [seeded(input), little];
  assert.sameValue(localGetFloat32(selected, 0, order), expected);
}
console.log("floats-f32-get-specials-tuple:ok");
