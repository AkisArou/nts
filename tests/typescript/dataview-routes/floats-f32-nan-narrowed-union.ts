/*---
description: "Float32 preserves NaN while finite witnesses distinguish both narrowed branches through a discriminated payload union."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-unions, ts-objects]
---*/

// Float32 preserves NaN while finite witnesses distinguish both narrowed branches; route: a discriminated payload union. Node prints floats-f32-nan-narrowed-union:ok.
type View = DataView;
type Payload = { kind: "value"; view: View; value: number } | { kind: "difference"; view: View; left: number; right: number };
function fresh(): View { return new DataView(new ArrayBuffer(4)); }
function store(packet: Payload, little: boolean): number {
  if (packet.kind === "value") packet.view.setFloat32(0, packet.value, little);
  else packet.view.setFloat32(0, packet.left - packet.right, little);
  return packet.view.getFloat32(0, little);
}
const plans: readonly [Payload, number][] = [
  [{ kind: "value", view: fresh(), value: NaN }, NaN], [{ kind: "value", view: fresh(), value: 1.5 }, 1.5],
  [{ kind: "difference", view: fresh(), left: Infinity, right: Infinity }, NaN],
  [{ kind: "difference", view: fresh(), left: 5, right: 7.5 }, -2.5],
];
for (const [packet, expected] of plans) for (const little of [false, true]) {
  const result: number = store(packet, little);
  if (Number.isNaN(expected)) assert.sameValue(Number.isNaN(result), true);
  else assert.sameValue(result, expected);
}
console.log("floats-f32-nan-narrowed-union:ok");
