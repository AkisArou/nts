/*---
description: "Float64 preserves NaN and neighboring finite values without asserting NaN bytes through a constrained generic at two object type arguments. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-generics, ts-generic-constraints, ts-objects, ts-strings]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
const localFloat64: readonly [number, number, readonly number[]][] = [
  [NaN, NaN, [127, 248, 0, 0, 0, 0, 0, 0]],
  [0.1, 0.1, [63, 185, 153, 153, 153, 153, 153, 154]],
  [-2.5, -2.5, [192, 4, 0, 0, 0, 0, 0, 0]],
];
function localSetFloat64(bytes: number[], offset: number, value: number, little: boolean = false): void {
  for (const entry of localFloat64) if (Object.is(value, entry[0])) {
    for (let i = 0; i < 8; i++) bytes[offset + i] = entry[2][little ? 7 - i : i]; return;
  }
  throw new RangeError("unlisted float input");
}
function localGetFloat64(bytes: number[], offset: number, little: boolean = false): number {
  for (const entry of localFloat64) { let matches: boolean = true;
    for (let i = 0; i < 8; i++) if (bytes[offset + i] !== entry[2][little ? 7 - i : i]) matches = false;
    if (matches) return entry[1];
  }
  throw new RangeError("unlisted float bytes");
}
// Float64 preserves NaN and neighboring finite values without asserting NaN bytes; route: a constrained generic at two object type arguments. Node prints floats-f64-nan-generic:ok.
type View = number[];
type NumberPacket = { view: View; value: number; label: number };
type TextPacket = { view: View; value: number; label: string };
function fresh(): View { return localDataView(localArrayBuffer(8)); }
function store<T extends { view: View; value: number }>(packet: T, little: boolean): number {
  localSetFloat64(packet.view, 0, packet.value, little); return localGetFloat64(packet.view, 0, little);
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
