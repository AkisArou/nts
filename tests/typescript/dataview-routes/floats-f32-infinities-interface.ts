/*---
description: "Float32 infinity signs and byte orders survive implementation dispatch through an interface with two writer implementations."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-interfaces, ts-class, ts-unions, ts-null-undefined]
---*/

// Float32 infinity signs and byte orders survive implementation dispatch; route: an interface with two writer implementations. Node prints floats-f32-infinities-interface:ok.
type View = DataView;
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.byteLength; i++) result[i] = view.getUint8(i); return result;
}
interface FloatWriter { store(view: View, value: number, little: boolean | undefined): number; }
class DefaultWriter implements FloatWriter { store(view: View, value: number): number { view.setFloat32(1, value); return view.getFloat32(1); } }
class OrderedWriter implements FloatWriter { store(view: View, value: number, little: boolean | undefined): number { view.setFloat32(1, value, little); return view.getFloat32(1, little); } }
const plans: readonly [FloatWriter, boolean | undefined][] = [[new DefaultWriter(), undefined], [new OrderedWriter(), false], [new OrderedWriter(), true]];
const rows: readonly [number, number, readonly number[]][] = [
  [Infinity, Infinity, [127, 128, 0, 0]],
  [-Infinity, -Infinity, [255, 128, 0, 0]],
];
for (const [writer, little] of plans) for (const [value, expected, encoded] of rows) {
  const view: View = new DataView(new ArrayBuffer(6));
  assert.sameValue(writer.store(view, value, little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 4; i++) bytes[1 + i] = encoded[little ? 3 - i : i];
  assert.compareArray(readBytes(view), bytes);
}
console.log("floats-f32-infinities-interface:ok");
