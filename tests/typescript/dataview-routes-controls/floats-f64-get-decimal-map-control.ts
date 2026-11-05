/*---
description: "Float64 getters recover the exact binary64 decimal values from independent literal bytes through a guarded Map get. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-map-set, ts-strings, ts-null-undefined]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
const localFloat64: readonly [number, number, readonly number[]][] = [
  [0.1, 0.1, [63, 185, 153, 153, 153, 153, 153, 154]],
  [-0.1, -0.1, [191, 185, 153, 153, 153, 153, 153, 154]],
  [-0.3, -0.3, [191, 211, 51, 51, 51, 51, 51, 51]],
];
function localGetFloat64(bytes: number[], offset: number, little: boolean = false): number {
  for (const entry of localFloat64) { let matches: boolean = true;
    for (let i = 0; i < 8; i++) if (bytes[offset + i] !== entry[2][little ? 7 - i : i]) matches = false;
    if (matches) return entry[1];
  }
  throw new RangeError("unlisted float bytes");
}
// Float64 getters recover the exact binary64 decimal values from independent literal bytes; route: a guarded Map get. Node prints floats-f64-get-decimal-map:ok.
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
  [0.1, [63, 185, 153, 153, 153, 153, 153, 154]],
  [-0.1, [191, 185, 153, 153, 153, 153, 153, 154]],
  [-0.3, [191, 211, 51, 51, 51, 51, 51, 51]],
];
for (const [expected, encoded] of rows) for (const little of [false, true]) {
  const input: number[] = [90, 0, 0, 0, 0, 0, 0, 0, 0, 165];
  for (let i = 0; i < 8; i++) input[1 + i] = encoded[little ? 7 - i : i];
  const views: Map<string, View> = new Map([["packet", seeded(input)]]);
  const selected = views.get("packet");
  if (selected === undefined) throw new Error("missing view");
  assert.sameValue(localGetFloat64(selected, 1, little), expected);
  assert.compareArray(readBytes(selected), input);
}
console.log("floats-f64-get-decimal-map:ok");
