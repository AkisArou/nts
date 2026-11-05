/*---
description: "Float64 getters recover the exact binary64 decimal values from independent literal bytes through a guarded Map get."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-map-set, ts-strings, ts-null-undefined]
---*/

// Float64 getters recover the exact binary64 decimal values from independent literal bytes; route: a guarded Map get. Node prints floats-f64-get-decimal-map:ok.
type View = DataView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
function seeded(input: readonly number[]): View {
  const view: View = new DataView(new ArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) view.setUint8(i, input[i]);
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
  assert.sameValue(selected.getFloat64(1, little), expected);
  assert.compareArray(readBytes(selected), input);
}
console.log("floats-f64-get-decimal-map:ok");
