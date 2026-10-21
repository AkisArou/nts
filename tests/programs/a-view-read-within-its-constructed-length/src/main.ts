// A typed array made with a length of its own keeps that length for its whole
// life, where nothing in the program can detach or resize a buffer. So a scan
// guarded by the constructed length reads and writes without a bounds test:
// `new Uint8Array(4096)` scanned under `i < 4096`, and a view of eight
// elements at an offset into a larger buffer, scanned under `i < 8`.
//
// `a-view-read-within-its-constructed-length-after-a-transfer` is the control:
// the same reads in a program that also transfers a buffer, where a view's
// length can become zero and every test stays.
//
// expect-ir: all: no array.get.checked in sumOwned
// expect-ir: all: no array.set.checked in sumOwned
// expect-ir: all: no array.get.checked in sumWindow

export function sumOwned(seed: number): number {
  const data = new Uint8Array(4096);
  for (let i = 0; i < 4096; i++) data[i] = (seed * 31 + i * 7) & 0xff;
  let total = 0;
  for (let i = 0; i < 4096; i++) total = (total * 33 + data[i]) | 0;
  return total;
}

export function sumWindow(seed: number): number {
  const buffer = new ArrayBuffer(64);
  const whole = new Uint32Array(buffer);
  for (let i = 0; i < whole.length; i++) whole[i] = (seed + i * 2654435761) >>> 0;
  const window = new Uint32Array(buffer, 16, 8);
  let total = 0;
  for (let i = 0; i < 8; i++) total = (total ^ window[i]) >>> 0;
  return total;
}

