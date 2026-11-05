/*---
description: "Float32 getters decode decimal values from independent literal bytes without changing them through a guarded Map get."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-map-set, ts-strings, ts-null-undefined]
---*/

// Float32 getters decode decimal values from independent literal bytes without changing them; route: a guarded Map get. Node prints floats-f32-get-decimal-map:ok.
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
  assert.sameValue(selected.getFloat32(1, little), expected);
  assert.compareArray(readBytes(selected), input);
}
console.log("floats-f32-get-decimal-map:ok");
