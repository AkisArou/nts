/*---
description: "Float64 getters preserve integer precision beyond binary32 from literal bytes in both union arms through a discriminated union of view holders."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-unions, ts-objects]
---*/

// Float64 getters preserve integer precision beyond binary32 from literal bytes in both union arms; route: a discriminated union of view holders. Node prints floats-f64-get-integer-union:ok.
type View = DataView;
function seeded(input: readonly number[]): View {
  const view: View = new DataView(new ArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) view.setUint8(i, input[i]);
  return view;
}
type FloatSelection = { kind: "direct"; view: View } | { kind: "nested"; entry: { view: View } };
function read(packet: FloatSelection, little: boolean): number {
  if (packet.kind === "direct") return packet.view.getFloat64(1, little);
  return packet.entry.view.getFloat64(1, little);
}
const rows: readonly [number, readonly number[]][] = [
  [16777217, [65, 112, 0, 0, 16, 0, 0, 0]],
  [-16777217, [193, 112, 0, 0, 16, 0, 0, 0]],
  [9007199254740991, [67, 63, 255, 255, 255, 255, 255, 255]],
];
for (const [expected, encoded] of rows) for (const little of [false, true]) {
  const input: number[] = [90, 0, 0, 0, 0, 0, 0, 0, 0, 165];
  for (let i = 0; i < 8; i++) input[1 + i] = encoded[little ? 7 - i : i];
  const first: FloatSelection = { kind: "direct", view: seeded(input) };
  const second: FloatSelection = { kind: "nested", entry: { view: seeded(input) } };
  assert.sameValue(read(first, little), expected);
  assert.sameValue(read(second, little), expected);
}
console.log("floats-f64-get-integer-union:ok");
