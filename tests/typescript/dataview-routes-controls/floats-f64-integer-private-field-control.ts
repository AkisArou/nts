/*---
description: "Float64 preserves integers that binary32 cannot retain including the largest safe integer through a private view field. (control)"
features: [ts-dataview-routes, ts-dataview-route-floats, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-tuples, ts-class, ts-class-fields, ts-private-fields]
---*/

function localArrayBuffer(length: number): number[] { const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
const localFloat64: readonly [number, number, readonly number[]][] = [
  [16777217, 16777217, [65, 112, 0, 0, 16, 0, 0, 0]],
  [-16777217, -16777217, [193, 112, 0, 0, 16, 0, 0, 0]],
  [9007199254740991, 9007199254740991, [67, 63, 255, 255, 255, 255, 255, 255]],
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
// Float64 preserves integers that binary32 cannot retain including the largest safe integer; route: a private view field. Node prints floats-f64-integer-private-field:ok.
type View = number[];
function readBytes(view: View): number[] {
  const result: number[] = []; for (let i = 0; i < view.length; i++) result[i] = localGetUint8(view, i); return result;
}
class FloatBox {
  #view: View = localDataView(localArrayBuffer(10));
  store(value: number, little: boolean): number { localSetFloat64(this.#view, 1, value, little); return localGetFloat64(this.#view, 1, little); }
  bytes(): number[] { return readBytes(this.#view); }
}
const rows: readonly [number, number, readonly number[]][] = [
  [16777217, 16777217, [65, 112, 0, 0, 16, 0, 0, 0]],
  [-16777217, -16777217, [193, 112, 0, 0, 16, 0, 0, 0]],
  [9007199254740991, 9007199254740991, [67, 63, 255, 255, 255, 255, 255, 255]],
];
for (const [value, expected, encoded] of rows) for (const little of [false, true]) {
  const box: FloatBox = new FloatBox();
  assert.sameValue(box.store(value, little), expected);
  const bytes: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 8; i++) bytes[1 + i] = encoded[little ? 7 - i : i];
  assert.compareArray(box.bytes(), bytes);
}
console.log("floats-f64-integer-private-field:ok");
