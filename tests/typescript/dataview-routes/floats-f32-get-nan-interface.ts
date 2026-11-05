/*---
description: "Float32 getters recognize distinct NaN inputs without fixing their output encoding through two reader interface implementations."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-interfaces, ts-class]
---*/

// Float32 getters recognize distinct NaN inputs without fixing their output encoding; route: two reader interface implementations. Node prints floats-f32-get-nan-interface:ok.
type View = DataView;
function seeded(input: readonly number[]): View {
  const view: View = new DataView(new ArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) view.setUint8(i, input[i]);
  return view;
}
interface FloatReader { read(view: View): number; }
class BigReader implements FloatReader { read(view: View): number { return view.getFloat32(0, false); } }
class LittleReader implements FloatReader { read(view: View): number { return view.getFloat32(0, true); } }
const plans: readonly [FloatReader, boolean][] = [[new BigReader(), false], [new LittleReader(), true]];
const patterns: readonly (readonly number[])[] = [[127, 192, 0, 0], [127, 128, 0, 1], [255, 192, 0, 7]];
for (const [reader, little] of plans) for (const encoded of patterns) {
  const input: number[] = [];
  for (let i = 0; i < 4; i++) input[i] = encoded[little ? 3 - i : i];
  assert.sameValue(Number.isNaN(reader.read(seeded(input))), true);
}
console.log("floats-f32-get-nan-interface:ok");
