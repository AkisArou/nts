/*---
description: "Float32 getters decode decimal values from independent literal bytes without changing them through a guarded Map get. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-map-set, ts-strings, ts-null-undefined]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
const localFloat32: readonly [number, number, readonly number[]][] = [
  [0.1, 0.10000000149011612, [61, 204, 204, 205]],
  [-0.1, -0.10000000149011612, [189, 204, 204, 205]],
  [-0.3, -0.30000001192092896, [190, 153, 153, 154]],
];
function localGetFloat32(bytes: number[], offset: number, little: boolean = false): number {
  for (const entry of localFloat32) { let matches: boolean = true;
    for (let i = 0; i < 4; i++) if (bytes[offset + i] !== entry[2][little ? 3 - i : i]) matches = false;
    if (matches) return entry[1];
  }
  throw new RangeError("unlisted float bytes");
}
// Float32 getters decode decimal values from independent literal bytes without changing them; route: a guarded Map get. Node prints floats-f32-get-decimal-map:ok.
type View = number[];
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGetUint8(view, i); return result;
}
function seeded(input: readonly number[]): View {
  const view: View = localDataView(localArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) localSetUint8(view, i, input[i]);
  return view;
}
const rows: readonly [number, readonly number[]][] = [
  [0.10000000149011612, [61, 204, 204, 205]],
  [-0.10000000149011612, [189, 204, 204, 205]],
  [-0.30000001192092896, [190, 153, 153, 154]],
];
for (const [expected, encoded] of rows) for (const little of [false, true]) {
  const input: number[] = [90, 0, 0, 0, 0, 165];
  for (let i = 0; i < 4; i++) input[1 + i] = encoded[little ? 3 - i : i];
  const views: Map<string, View> = new Map([["packet", seeded(input)]]);
  const selected = views.get("packet");
  if (selected === undefined) throw new Error("missing view");
  assert.sameValue(localGetFloat32(selected, 1, little), expected);
  assert.compareArray(readBytes(selected), input);
}
console.log("floats-f32-get-decimal-map:ok");
