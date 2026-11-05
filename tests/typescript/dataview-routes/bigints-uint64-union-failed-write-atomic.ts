/*---
description: "A failed BigUint64 write leaves every byte unchanged in both byte orders and a valid final-word write preserves the leading bytes."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-unions, ts-narrowing, ts-objects, ts-strings, ts-readonly, ts-errors, ts-arrow-functions]
---*/

// A failed BigUint64 write leaves every byte unchanged in both byte orders and a valid final-word write preserves the leading bytes. Route: a discriminated union selecting the writer byte order. Node prints bigints-uint64-union-failed-write-atomic:ok.
type View = DataView;
type WriteJob = { kind: "big"; view: View } | { kind: "little"; view: View };
function write(job: WriteJob, offset: number, value: bigint): void {
  if (job.kind === "big") job.view.setBigUint64(offset, value, false); else job.view.setBigUint64(offset, value, true);
}
const seed: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
for (const little of [false, true]) {
  const view: View = new DataView(new ArrayBuffer(12)), job: WriteJob = little ? { kind: "little", view } : { kind: "big", view };
  for (let i = 0; i < 12; i++) view.setUint8(i, seed[i]);
  for (const offset of [-1, 5, 12]) {
    assert.throws(RangeError, () => write(job, offset, 0x89abcdef01234567n));
    const bytes: number[] = []; for (let i = 0; i < 12; i++) bytes[i] = view.getUint8(i); assert.compareArray(bytes, seed);
  }
  write(job, 4, 0x89abcdef01234567n);
  const finalBytes: number[] = []; for (let j = 0; j < 12; j++) finalBytes[j] = view.getUint8(j);
  assert.compareArray(finalBytes, little ? [1, 2, 3, 4, 103, 69, 35, 1, 239, 205, 171, 137] : [1, 2, 3, 4, 137, 171, 205, 239, 1, 35, 69, 103]);
}
console.log("bigints-uint64-union-failed-write-atomic:ok");
