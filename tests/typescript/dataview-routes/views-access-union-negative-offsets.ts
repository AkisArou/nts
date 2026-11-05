/*---
description: "Negative offsets that truncate below zero throw before signed-byte or signed-word access, while a subunit negative offset selects zero."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-discriminated-unions, ts-narrowing, ts-strings]
---*/

// Negative offsets that truncate below zero throw before signed-byte or signed-word access, while a subunit negative offset selects zero. Route: a discriminated union selecting signed accessor widths. Node prints views-access-union-negative-offsets:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < view.byteLength; i++) bytes[i] = view.getUint8(i); return bytes; }
type AccessJob = { kind: "byte"; view: View } | { kind: "word"; view: View };
function read(job: AccessJob, offset: number): number { return job.kind === "byte" ? job.view.getInt8(offset) : job.view.getInt32(offset, false); }
function write(job: AccessJob, offset: number, value: number): void { if (job.kind === "byte") job.view.setInt8(offset, value); else job.view.setInt32(offset, value, false); }
const rows: readonly ["byte" | "word", number, readonly number[]][] = [
  ["byte", -2, [90, 90, 254, 90, 90, 90, 90, 90]], ["byte", 127, [90, 90, 127, 90, 90, 90, 90, 90]],
  ["word", -2147483647, [90, 90, 128, 0, 0, 1, 90, 90]], ["word", 305419896, [90, 90, 18, 52, 86, 120, 90, 90]]
];
for (const [kind, value, expected] of rows) {
  const buffer: BufferStorage = new ArrayBuffer(8), whole: View = new DataView(buffer), view: View = new DataView(buffer, 2, 4);
  const job: AccessJob = kind === "byte" ? { kind: "byte", view } : { kind: "word", view };
  for (let i = 0; i < 8; i++) whole.setUint8(i, 90);
  write(job, -0.9, value); assert.sameValue(read(job, -0.9), value); assert.compareArray(readBytes(whole), expected);
  for (const offset of [-1, -1.9, -Infinity]) {
    assert.throws(RangeError, () => read(job, offset)); assert.throws(RangeError, () => write(job, offset, value)); assert.compareArray(readBytes(whole), expected);
  }
}
console.log("views-access-union-negative-offsets:ok");
