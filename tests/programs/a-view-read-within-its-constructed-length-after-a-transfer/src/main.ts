// The control for `a-view-read-within-its-constructed-length`: the same scans
// in a program that also transfers a buffer. A transfer detaches its source,
// and a view over a detached buffer has length zero, so no view's constructed
// length is a fact any more and every test stays. `afterTransfer` is why: its
// view was made with eight elements and reads none.
//
// expect-ir: all: count array.get.checked in sumOwned >= 1
// expect-ir: all: count array.get.checked in sumWindow >= 1

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

export function afterTransfer(seed: number): number {
  const buffer = new ArrayBuffer(32);
  const view = new Uint8Array(buffer, 0, 8);
  for (let i = 0; i < 8; i++) view[i] = seed + i;
  const moved = buffer.transfer();
  // Zero: the view was made with eight elements, and its buffer is gone.
  return view.length * 1000 + moved.byteLength + moved.slice(0, 1).byteLength;
}
