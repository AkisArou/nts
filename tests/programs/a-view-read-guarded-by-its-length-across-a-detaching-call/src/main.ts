// A typed array read under a guard by its own `.length`, where a call between
// the guard and the read can detach or shrink its buffer. `bounds` trusts the
// guard's relation only up to the first op that may move a length, so each of
// these reads stays checked. A read proven anyway is a bare index into the
// buffer's bytes on every backend: past a transfer there are none, and past a
// resize there are stale ones, where node answers `undefined`.
//
// `sumGuarded` and `scaleGuarded` are the controls: the same guard with no call
// between it and the access, in the same program, and their reads are proven,
// as are `scaleGuarded`'s stores, which convert through no call.
// `compiler/codegen/jvm/tests/proved_views.rs` reads which accessor each took.
//
// Every other scan detaches or resizes at element 5 and only for the seed 41,
// which the differential's pool does not hold, so no case moves a buffer and
// every case compares. What the fixture holds is the shape the proof must
// respect, a call that *can* move the buffer between guard and read, and the
// `expect-ir` facts read that. A trigger the pool does reach makes each such
// case one the compiled program declines, where node answers `undefined`:
// an example that compares only part of its cases, which the backend steps
// count against a ceiling.
//
// expect-ir: all: no array.get.checked in sumGuarded
// expect-ir: all: no array.get.checked in scaleGuarded
// expect-ir: all: no array.set.checked in scaleGuarded
// expect-ir: all: count array.get.checked in readAfterACall >= 1
// expect-ir: all: count array.get.checked in readAfterABranch >= 1
// expect-ir: all: count array.get.checked in readAfterAResize >= 1
// expect-ir: all: count array.get.checked in scan >= 1

export function sumGuarded(seed: number): number {
  const buffer = new ArrayBuffer(16);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < view.length; i++) view[i] = (seed + i * 7) & 0xff;
  let total = 0;
  for (let i = 0; i < view.length; i++) total = (total * 31 + view[i]) | 0;
  buffer.transfer();
  return total + view.length;
}

export function scaleGuarded(seed: number): number {
  const values = new Float64Array(8);
  for (let i = 0; i < values.length; i++) values[i] = seed * i;
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total;
}

function detachAt(buffer: ArrayBuffer, i: number, seed: number): number {
  if (i === 5 && seed === 41) buffer.transfer();
  return i;
}

export function readAfterACall(seed: number): number {
  const buffer = new ArrayBuffer(8);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < view.length; i++) view[i] = seed + i;
  let total = 0;
  for (let i = 0; i < view.length; i++) {
    total = (total * 31 + detachAt(buffer, i, seed) + view[i]) | 0;
  }
  return total;
}

export function readAfterABranch(seed: number): number {
  const buffer = new ArrayBuffer(8);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < view.length; i++) view[i] = seed + i;
  let total = 0;
  for (let i = 0; i < view.length; i++) {
    if (i === 5 && seed === 41) buffer.transfer();
    total = (total * 31 + view[i]) | 0;
  }
  return total;
}

export function readAfterAResize(seed: number): number {
  const buffer = new ArrayBuffer(8, { maxByteLength: 8 });
  const view = new Uint8Array(buffer);
  for (let i = 0; i < view.length; i++) view[i] = seed + i + 1;
  let total = 0;
  for (let i = 0; i < view.length; i++) {
    if (i === 5 && seed === 41) buffer.resize(2);
    total = (total * 31 + view[i]) | 0;
  }
  return total;
}

function release(buffer: ArrayBuffer, i: number, seed: number): void {
  if (i === 5 && seed === 41) buffer.transfer();
}

function scan(view: Uint8Array, buffer: ArrayBuffer, seed: number): number {
  let total = 0;
  for (let i = 0; i < view.length; i++) {
    release(buffer, i, seed);
    total = (total * 31 + view[i]) | 0;
  }
  return total;
}

export function readAParameter(seed: number): number {
  const buffer = new ArrayBuffer(8);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < view.length; i++) view[i] = seed * 3 + i;
  return scan(view, buffer, seed);
}
