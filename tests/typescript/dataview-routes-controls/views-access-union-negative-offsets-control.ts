/*---
description: "Negative offsets that truncate below zero throw before signed-byte or signed-word access, while a subunit negative offset selects zero. (control)"
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-discriminated-unions, ts-narrowing, ts-strings]
---*/

type LocalView = { buffer: number[]; offset: number; length: number };
function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], offset = 0, length = buffer.length - offset): LocalView { return { buffer, offset, length }; }
function localByteLength(view: LocalView): number { return view.length; }
function localIndex(view: LocalView, offset: number, width: number): number {
  if (offset === Infinity || offset === -Infinity) throw new RangeError(); offset = offset !== offset ? 0 : offset - offset % 1;
  if (offset < 0 || offset + width > view.length) throw new RangeError(); return view.offset + offset;
}
function localIntegerGet(view: LocalView, offset: number, width: number, signed: boolean, little = false): number {
  const start = localIndex(view, offset, width); let value = 0; for (let i = 0; i < width; i++) value = value * 256 + view.buffer[start + (little ? width - 1 - i : i)];
  return signed && value >= 256 ** width / 2 ? value - 256 ** width : value; }
function localIntegerSet(view: LocalView, offset: number, value: number, width: number, little = false): void {
  const start = localIndex(view, offset, width), modulus = 256 ** width; if (value !== value || value === Infinity || value === -Infinity) value = 0;
  value -= value % 1; value = (value % modulus + modulus) % modulus;
  for (let i = 0; i < width; i++) { view.buffer[start + (little ? i : width - 1 - i)] = value % 256; value = (value - value % 256) / 256; } }
function localGetUint8(view: LocalView, offset: number): number { return view.buffer[localIndex(view, offset, 1)]; }
function localGetInt8(view: LocalView, offset: number): number { return localIntegerGet(view, offset, 1, true); }
function localGetInt32(view: LocalView, offset: number, little = false): number { return localIntegerGet(view, offset, 4, true, little); }
function localSetInt8(view: LocalView, offset: number, value: number): void { localIntegerSet(view, offset, value, 1); }
function localSetInt32(view: LocalView, offset: number, value: number, little = false): void { localIntegerSet(view, offset, value, 4, little); }
function localSetUint8(view: LocalView, offset: number, value: number): void { view.buffer[localIndex(view, offset, 1)] = value; }
// Negative offsets that truncate below zero throw before signed-byte or signed-word access, while a subunit negative offset selects zero. Route: a discriminated union selecting signed accessor widths. Node prints views-access-union-negative-offsets:ok.
type BufferStorage = number[];
type View = LocalView;
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < localByteLength(view); i++) bytes[i] = localGetUint8(view, i); return bytes; }
type AccessJob = { kind: "byte"; view: View } | { kind: "word"; view: View };
function read(job: AccessJob, offset: number): number { return job.kind === "byte" ? localGetInt8(job.view, offset) : localGetInt32(job.view, offset, false); }
function write(job: AccessJob, offset: number, value: number): void { if (job.kind === "byte") localSetInt8(job.view, offset, value); else localSetInt32(job.view, offset, value, false); }
const rows: readonly ["byte" | "word", number, readonly number[]][] = [
  ["byte", -2, [90, 90, 254, 90, 90, 90, 90, 90]], ["byte", 127, [90, 90, 127, 90, 90, 90, 90, 90]],
  ["word", -2147483647, [90, 90, 128, 0, 0, 1, 90, 90]], ["word", 305419896, [90, 90, 18, 52, 86, 120, 90, 90]]
];
for (const [kind, value, expected] of rows) {
  const buffer: BufferStorage = localArrayBuffer(8), whole: View = localDataView(buffer), view: View = localDataView(buffer, 2, 4);
  const job: AccessJob = kind === "byte" ? { kind: "byte", view } : { kind: "word", view };
  for (let i = 0; i < 8; i++) localSetUint8(whole, i, 90);
  write(job, -0.9, value); assert.sameValue(read(job, -0.9), value); assert.compareArray(readBytes(whole), expected);
  for (const offset of [-1, -1.9, -Infinity]) {
    assert.throws(RangeError, () => read(job, offset)); assert.throws(RangeError, () => write(job, offset, value)); assert.compareArray(readBytes(whole), expected);
  }
}
console.log("views-access-union-negative-offsets:ok");
