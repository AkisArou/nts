/*---
description: "Float32 getters retain exact integer boundary values from independent literal bytes through a constrained generic at two object type arguments. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-generics, ts-generic-constraints, ts-objects, ts-strings]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
const localFloat32: readonly [number, number, readonly number[]][] = [
  [16777216, 16777216, [75, 128, 0, 0]],
  [16777218, 16777218, [75, 128, 0, 1]],
  [-16777217, -16777216, [203, 128, 0, 0]],
];
function localGetFloat32(bytes: number[], offset: number, little: boolean = false): number {
  for (const entry of localFloat32) { let matches: boolean = true;
    for (let i = 0; i < 4; i++) if (bytes[offset + i] !== entry[2][little ? 3 - i : i]) matches = false;
    if (matches) return entry[1];
  }
  throw new RangeError("unlisted float bytes");
}
// Float32 getters retain exact integer boundary values from independent literal bytes; route: a constrained generic at two object type arguments. Node prints floats-f32-get-integer-generic:ok.
type View = number[];
function seeded(input: readonly number[]): View {
  const view: View = localDataView(localArrayBuffer(input.length));
  for (let i = 0; i < input.length; i++) localSetUint8(view, i, input[i]);
  return view;
}
type NumberPacket = { view: View; label: number };
type TextPacket = { view: View; label: string };
function read<T extends { view: View }>(packet: T, little: boolean): number { return localGetFloat32(packet.view, 1, little); }
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
