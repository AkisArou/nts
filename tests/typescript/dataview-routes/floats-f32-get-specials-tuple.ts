/*---
description: "Float32 getters retain both zero signs and infinity signs from independent literal bytes through a destructured readonly view and endian tuple."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples]
---*/

// Float32 getters retain both zero signs and infinity signs from independent literal bytes; route: a destructured readonly view and endian tuple. Node prints floats-f32-get-specials-tuple:ok.
type View = DataView;
function seeded(input: readonly number[]): View {
  const view: View = new DataView(new ArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) view.setUint8(i, input[i]);
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
  assert.sameValue(selected.getFloat32(0, order), expected);
}
console.log("floats-f32-get-specials-tuple:ok");
