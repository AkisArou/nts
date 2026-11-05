/*---
description: "Float32 underflow retains the zero sign while minimal subnormals remain nonzero through a captured number binding. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-closures]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
const localFloat32: readonly [number, number, readonly number[]][] = [
  [1e-50, 0, [0, 0, 0, 0]],
  [-1e-50, -0, [128, 0, 0, 0]],
  [1.401298464324817e-45, 1.401298464324817e-45, [0, 0, 0, 1]],
  [-1.401298464324817e-45, -1.401298464324817e-45, [128, 0, 0, 1]],
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
// Float32 underflow retains the zero sign while minimal subnormals remain nonzero; route: a captured number binding. Node prints floats-f32-underflow-captured-let:ok.
type View = number[];
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGetUint8(view, i); return result;
}
const view: View = localDataView(localArrayBuffer(6));
let current: number = 0;
const store = (little: boolean): number => { localSetFloat32(view, 1, current, little); return localGetFloat32(view, 1, little); };
const rows: readonly [number, number, readonly number[]][] = [
  [1e-50, 0, [0, 0, 0, 0]],
  [-1e-50, -0, [128, 0, 0, 0]],
  [1.401298464324817e-45, 1.401298464324817e-45, [0, 0, 0, 1]],
  [-1.401298464324817e-45, -1.401298464324817e-45, [128, 0, 0, 1]],
];
for (const [value, expected, encoded] of rows) for (const little of [false, true]) {
  current = value;
  assert.sameValue(store(little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 4; i++) bytes[1 + i] = encoded[little ? 3 - i : i];
  assert.compareArray(readBytes(view), bytes);
}
console.log("floats-f32-underflow-captured-let:ok");
