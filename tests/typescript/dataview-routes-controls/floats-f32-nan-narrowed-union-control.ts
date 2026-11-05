/*---
description: "Float32 preserves NaN while finite witnesses distinguish both narrowed branches through a discriminated payload union. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-unions, ts-objects]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
const localFloat32: readonly [number, number, readonly number[]][] = [
  [NaN, NaN, [127, 192, 0, 0]],
  [1.5, 1.5, [63, 192, 0, 0]],
  [-2.5, -2.5, [192, 32, 0, 0]],
];
function localSetFloat32(bytes: number[], offset: number, value: number, little: boolean = false): void {
  for (const entry of localFloat32) if (Object.is(value, entry[0])) {
    for (let i = 0; i < 4; i++) bytes[offset + i] = entry[2][little ? 3 - i : i]; return;
  }
  throw new RangeError("unlisted float input");
}
function localGetFloat32(bytes: number[], offset: number, little: boolean = false): number {
  for (const entry of localFloat32) { let matches: boolean = true;
    for (let i = 0; i < 4; i++) if (bytes[offset + i] !== entry[2][little ? 3 - i : i]) matches = false;
    if (matches) return entry[1];
  }
  throw new RangeError("unlisted float bytes");
}
// Float32 preserves NaN while finite witnesses distinguish both narrowed branches; route: a discriminated payload union. Node prints floats-f32-nan-narrowed-union:ok.
type View = number[];
type Payload = { kind: "value"; view: View; value: number } | { kind: "difference"; view: View; left: number; right: number };
function fresh(): View { return localDataView(localArrayBuffer(4)); }
function store(packet: Payload, little: boolean): number {
  if (packet.kind === "value") localSetFloat32(packet.view, 0, packet.value, little);
  else localSetFloat32(packet.view, 0, packet.left - packet.right, little);
  return localGetFloat32(packet.view, 0, little);
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
