/*---
description: "Float32 stores positive and negative zero with exact signs in either explicit order and the default order through readonly value and endian tuples. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-unions, ts-null-undefined]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
const localFloat32: readonly [number, number, readonly number[]][] = [
  [0, 0, [0, 0, 0, 0]],
  [-0, -0, [128, 0, 0, 0]],
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
// Float32 stores positive and negative zero with exact signs in either explicit order and the default order; route: readonly value and endian tuples. Node prints floats-f32-zero-readonly-rows:ok.
type View = number[];
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGetUint8(view, i); return result;
}
const plans: readonly [number, boolean | undefined, readonly number[]][] = [
  [0, undefined, [0, 0, 0, 0]], [-0, undefined, [128, 0, 0, 0]],
  [0, false, [0, 0, 0, 0]], [-0, false, [128, 0, 0, 0]],
  [0, true, [0, 0, 0, 0]], [-0, true, [0, 0, 0, 128]],
];
for (const [value, little, expected] of plans) {
  const view: View = localDataView(localArrayBuffer(4));
  let result: number;
  if (little === undefined) { localSetFloat32(view, 0, value); result = localGetFloat32(view, 0); }
  else { localSetFloat32(view, 0, value, little); result = localGetFloat32(view, 0, little); }
  assert.sameValue(result, value);
  assert.compareArray(readBytes(view), expected);
}
console.log("floats-f32-zero-readonly-rows:ok");
