/*---
description: "Float64 keeps both zero signs with omitted or explicit byte order through a captured number binding. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-closures, ts-unions, ts-null-undefined]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
const localFloat64: readonly [number, number, readonly number[]][] = [
  [0, 0, [0, 0, 0, 0, 0, 0, 0, 0]],
  [-0, -0, [128, 0, 0, 0, 0, 0, 0, 0]],
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
// Float64 keeps both zero signs with omitted or explicit byte order; route: a captured number binding. Node prints floats-f64-zero-captured-let:ok.
type View = number[];
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGetUint8(view, i); return result;
}
const view: View = localDataView(localArrayBuffer(10));
let current: number = 1;
const store = (little: boolean | undefined): number => {
  if (little === undefined) { localSetFloat64(view, 1, current); return localGetFloat64(view, 1); }
  localSetFloat64(view, 1, current, little); return localGetFloat64(view, 1, little);
};
const rows: readonly [number, number, readonly number[]][] = [
  [0, 0, [0, 0, 0, 0, 0, 0, 0, 0]],
  [-0, -0, [128, 0, 0, 0, 0, 0, 0, 0]],
];
for (const [value, expected, encoded] of rows) for (const little of [undefined, false, true]) {
  current = value;
  assert.sameValue(store(little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 8; i++) bytes[1 + i] = encoded[little ? 7 - i : i];
  assert.compareArray(readBytes(view), bytes);
}
console.log("floats-f64-zero-captured-let:ok");
