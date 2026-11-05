/*---
description: "Float64 preserves NaN and neighboring finite values without asserting NaN bytes through a constrained generic at two object type arguments."
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-generics, ts-generic-constraints, ts-objects, ts-strings]
---*/

// Float64 preserves NaN and neighboring finite values without asserting NaN bytes; route: a constrained generic at two object type arguments. Node prints floats-f64-nan-generic:ok.
type View = DataView;
type NumberPacket = { view: View; value: number; label: number };
type TextPacket = { view: View; value: number; label: string };
function fresh(): View { return new DataView(new ArrayBuffer(8)); }
function store<T extends { view: View; value: number }>(packet: T, little: boolean): number {
  packet.view.setFloat64(0, packet.value, little); return packet.view.getFloat64(0, little);
}
const values: readonly number[] = [NaN, 0 / 0, 0.1, -2.5];
for (const value of values) for (const little of [false, true]) {
  const first: NumberPacket = { view: fresh(), value, label: 7 };
  const second: TextPacket = { view: fresh(), value, label: "second" };
  const results: number[] = [store<NumberPacket>(first, little), store<TextPacket>(second, little)];
  for (const result of results) {
    if (Number.isNaN(value)) assert.sameValue(Number.isNaN(result), true);
    else assert.sameValue(result, value);
  }
}
console.log("floats-f64-nan-generic:ok");
