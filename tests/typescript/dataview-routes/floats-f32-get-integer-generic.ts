/*---
description: "Float32 getters retain exact integer boundary values from independent literal bytes through a constrained generic at two object type arguments."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-generics, ts-generic-constraints, ts-objects, ts-strings]
---*/

// Float32 getters retain exact integer boundary values from independent literal bytes; route: a constrained generic at two object type arguments. Node prints floats-f32-get-integer-generic:ok.
type View = DataView;
function seeded(input: readonly number[]): View {
  const view: View = new DataView(new ArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) view.setUint8(i, input[i]);
  return view;
}
type NumberPacket = { view: View; label: number };
type TextPacket = { view: View; label: string };
function read<T extends { view: View }>(packet: T, little: boolean): number { return packet.view.getFloat32(1, little); }
const rows: readonly [number, readonly number[]][] = [
  [16777216, [75, 128, 0, 0]],
  [16777218, [75, 128, 0, 1]],
  [-16777216, [203, 128, 0, 0]],
];
for (const [expected, encoded] of rows) for (const little of [false, true]) {
  const input: number[] = [90, 0, 0, 0, 0, 165];
  for (let i = 0; i < 4; i++) input[1 + i] = encoded[little ? 3 - i : i];
  const first: NumberPacket = { view: seeded(input), label: 7 };
  const second: TextPacket = { view: seeded(input), label: "second" };
  assert.sameValue(read<NumberPacket>(first, little), expected);
  assert.sameValue(read<TextPacket>(second, little), expected);
}
console.log("floats-f32-get-integer-generic:ok");
