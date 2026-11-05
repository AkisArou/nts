/*---
description: "Filter creates a fresh array of the selected signed or unsigned kind with its exact retained elements through a discriminated union of byte arrays."
features: [ts-typed-array-routes, ts-typed-array-route-copies, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-unions, ts-objects, ts-readonly, ts-tuples, ts-instanceof, ts-destructuring, ts-arrow-functions]
---*/

// Filter creates a fresh array of the selected signed or unsigned kind with its exact retained elements; route: a discriminated union of byte arrays. Node prints copies-filter-narrowed-byte-union:ok.
type Signed = Int8Array;
type Unsigned = Uint8Array;
type View = Signed | Unsigned;
type Packet = { kind: "signed"; data: Signed } | { kind: "unsigned"; data: Unsigned };
function elements(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = view[i]; return result;
}
function select(packet: Packet): View { return packet.kind === "signed" ? packet.data.filter(value => value < 0) : packet.data.filter(value => value > 127); }
const rows: readonly [Packet, readonly number[], readonly number[]][] = [
  [{ kind: "signed", data: new Int8Array([-128, 127, -1, 0]) }, [-128, 127, -1, 0], [-128, -1]],
  [{ kind: "unsigned", data: new Uint8Array([0, 255, 7, 128]) }, [0, 255, 7, 128], [255, 128]],
];
for (const [packet, input, expected] of rows) {
  const result: View = select(packet);
  assert.sameValue(result instanceof Int8Array, packet.kind === "signed"); assert.sameValue(result instanceof Uint8Array, packet.kind === "unsigned");
  assert.sameValue(result.buffer === packet.data.buffer, false); assert.sameValue(result === packet.data, false);
  assert.compareArray(elements(result), expected); assert.compareArray(elements(packet.data), input);
}
console.log("copies-filter-narrowed-byte-union:ok");
