/*---
description: "Float64 infinity signs have exact bytes in omitted and explicit byte orders through readonly value and endian tuples. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-unions, ts-null-undefined]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
const localFloat64: readonly [number, number, readonly number[]][] = [
  [Infinity, Infinity, [127, 240, 0, 0, 0, 0, 0, 0]],
  [-Infinity, -Infinity, [255, 240, 0, 0, 0, 0, 0, 0]],
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
// Float64 infinity signs have exact bytes in omitted and explicit byte orders; route: readonly value and endian tuples. Node prints floats-f64-infinities-readonly-tuples:ok.
type View = number[];
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGetUint8(view, i); return result;
}
const rows: readonly [number, number, readonly number[]][] = [
  [Infinity, Infinity, [127, 240, 0, 0, 0, 0, 0, 0]],
  [-Infinity, -Infinity, [255, 240, 0, 0, 0, 0, 0, 0]],
];
for (const [value, expected, encoded] of rows) for (const little of [undefined, false, true]) {
  const plan: readonly [number, boolean | undefined] = [value, little];
  const [selected, order] = plan;
  const view: View = localDataView(localArrayBuffer(10));
  let result: number;
  if (order === undefined) { localSetFloat64(view, 1, selected); result = localGetFloat64(view, 1); }
  else { localSetFloat64(view, 1, selected, order); result = localGetFloat64(view, 1, order); }
  assert.sameValue(result, expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 8; i++) bytes[1 + i] = encoded[little ? 7 - i : i];
  assert.compareArray(readBytes(view), bytes);
}
console.log("floats-f64-infinities-readonly-tuples:ok");
