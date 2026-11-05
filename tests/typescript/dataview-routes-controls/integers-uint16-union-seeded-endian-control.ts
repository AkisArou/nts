/*---
description: "Seeded Uint16 bytes retain their unsigned magnitudes and select the requested order separately from the signed interpretation. (control)"
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-unions, ts-narrowing, ts-objects, ts-strings, ts-readonly, ts-tuples, ts-destructuring]
---*/

function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localGet(bytes: number[], offset: number, width: number, signed: boolean, little = false): number {
  offset -= offset % 1; let value = 0; for (let i = 0; i < width; i++) value = value * 256 + bytes[offset + (little ? width - 1 - i : i)];
  return signed && value >= 256 ** width / 2 ? value - 256 ** width : value;
}
function localSet(bytes: number[], offset: number, value: number, width: number, little = false): void {
  offset -= offset % 1; const modulus = 256 ** width; if (value !== value || value === Infinity || value === -Infinity) value = 0;
  value -= value % 1; value = (value % modulus + modulus) % modulus;
  for (let i = 0; i < width; i++) { bytes[offset + (little ? i : width - 1 - i)] = value % 256; value = (value - value % 256) / 256; }
}
function localGetUint16(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 2, false, little); }
function localGetInt16(bytes: number[], offset: number, little = false): number { return localGet(bytes, offset, 2, true, little); }
function localSetUint8(bytes: number[], offset: number, value: number): void { localSet(bytes, offset, value, 1); }
function localGetUint8(bytes: number[], offset: number): number { return localGet(bytes, offset, 1, false); }
// Seeded Uint16 bytes retain their unsigned magnitudes and select the requested order separately from the signed interpretation. Route: a discriminated signed-or-unsigned reader job. Node prints integers-uint16-union-seeded-endian:ok.
type View = number[];
type ReadJob = { kind: "unsigned"; little: boolean } | { kind: "signed"; little: boolean };
function read(job: ReadJob, view: View): number {
  if (job.kind === "unsigned") return localGetUint16(view, 0, job.little);
  return localGetInt16(view, 0, job.little);
}
const jobs: readonly ReadJob[] = [
  { kind: "unsigned", little: false }, { kind: "unsigned", little: true },
  { kind: "signed", little: false }, { kind: "signed", little: true }
];
const rows: readonly [readonly number[], readonly number[]][] = [
  [[18, 52], [4660, 13330, 4660, 13330]], [[128, 255], [33023, 65408, -32513, -128]],
  [[255, 127], [65407, 32767, -129, 32767]], [[1, 128], [384, 32769, 384, -32767]]
];
for (const [seed, expected] of rows) {
  const view: View = localDataView(localArrayBuffer(2)); for (let i = 0; i < 2; i++) localSetUint8(view, i, seed[i]);
  const actual: number[] = []; for (let i = 0; i < jobs.length; i++) actual[i] = read(jobs[i], view);
  assert.compareArray(actual, expected);
  const bytes: number[] = []; for (let i = 0; i < 2; i++) bytes[i] = localGetUint8(view, i); assert.compareArray(bytes, seed);
}
console.log("integers-uint16-union-seeded-endian:ok");
