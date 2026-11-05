/*---
description: "Float32 getters recognize distinct NaN inputs without fixing their output encoding through two reader interface implementations. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-interfaces, ts-class]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
const localFloat32: readonly [number, number, readonly number[]][] = [
  [NaN, NaN, [127, 192, 0, 0]],
  [NaN, NaN, [127, 128, 0, 1]],
  [NaN, NaN, [255, 192, 0, 7]],
];
function localGetFloat32(bytes: number[], offset: number, little: boolean = false): number {
  for (const entry of localFloat32) { let matches: boolean = true;
    for (let i = 0; i < 4; i++) if (bytes[offset + i] !== entry[2][little ? 3 - i : i]) matches = false;
    if (matches) return entry[1];
  }
  throw new RangeError("unlisted float bytes");
}
// Float32 getters recognize distinct NaN inputs without fixing their output encoding; route: two reader interface implementations. Node prints floats-f32-get-nan-interface:ok.
type View = number[];
function seeded(input: readonly number[]): View {
  const view: View = localDataView(localArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) localSetUint8(view, i, input[i]);
  return view;
}
interface FloatReader { read(view: View): number; }
class BigReader implements FloatReader { read(view: View): number { return localGetFloat32(view, 0, false); } }
class LittleReader implements FloatReader { read(view: View): number { return localGetFloat32(view, 0, true); } }
const plans: readonly [FloatReader, boolean][] = [[new BigReader(), false], [new LittleReader(), true]];
const patterns: readonly (readonly number[])[] = [[127, 192, 0, 0], [127, 128, 0, 1], [255, 192, 0, 7]];
for (const [reader, little] of plans) for (const encoded of patterns) {
  const input: number[] = [];
  for (let i = 0; i < 4; i++) input[i] = encoded[little ? 3 - i : i];
  assert.sameValue(Number.isNaN(reader.read(seeded(input))), true);
}
console.log("floats-f32-get-nan-interface:ok");
