/*---
description: "Float32 infinity signs and byte orders survive implementation dispatch through an interface with two writer implementations. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-interfaces, ts-class, ts-unions, ts-null-undefined]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
const localFloat32: readonly [number, number, readonly number[]][] = [
  [Infinity, Infinity, [127, 128, 0, 0]],
  [-Infinity, -Infinity, [255, 128, 0, 0]],
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
// Float32 infinity signs and byte orders survive implementation dispatch; route: an interface with two writer implementations. Node prints floats-f32-infinities-interface:ok.
type View = number[];
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGetUint8(view, i); return result;
}
interface FloatWriter { store(view: View, value: number, little: boolean | undefined): number; }
class DefaultWriter implements FloatWriter { store(view: View, value: number): number { localSetFloat32(view, 1, value); return localGetFloat32(view, 1); } }
class OrderedWriter implements FloatWriter { store(view: View, value: number, little: boolean | undefined): number { localSetFloat32(view, 1, value, little); return localGetFloat32(view, 1, little); } }
const plans: readonly [FloatWriter, boolean | undefined][] = [[new DefaultWriter(), undefined], [new OrderedWriter(), false], [new OrderedWriter(), true]];
const rows: readonly [number, number, readonly number[]][] = [
  [Infinity, Infinity, [127, 128, 0, 0]],
  [-Infinity, -Infinity, [255, 128, 0, 0]],
];
for (const [writer, little] of plans) for (const [value, expected, encoded] of rows) {
  const view: View = localDataView(localArrayBuffer(6));
  assert.sameValue(writer.store(view, value, little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 4; i++) bytes[1 + i] = encoded[little ? 3 - i : i];
  assert.compareArray(readBytes(view), bytes);
}
console.log("floats-f32-infinities-interface:ok");
