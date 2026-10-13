// Which typed-array kinds own their buffers. One function per way a buffer
// can stay private or escape.

// Float64Array: allocated by its constructor, read, summed. Owned.
export function sumDoubles(n: number): number {
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = i * 0.5;
  let total = 0;
  for (let i = 0; i < n; i++) total += xs[i]!;
  return total;
}

// Int32Array over an ArrayBuffer nothing else touches. Owned.
export function overItsOwnBuffer(n: number): number {
  const buffer = new ArrayBuffer(n * 4);
  const ints = new Int32Array(buffer);
  ints[0] = n;
  return ints[0]!;
}

// Uint16Array whose `.buffer` is read: exposed.
export function bufferRead(n: number): number {
  const shorts = new Uint16Array(n);
  return shorts.buffer.byteLength;
}

// Float32Array and Uint8Array over one buffer: both exposed.
export function twoKindsOneBuffer(n: number): number {
  const buffer = new ArrayBuffer(n * 4);
  const floats = new Float32Array(buffer);
  const bytes = new Uint8Array(buffer);
  floats[0] = 1.5;
  return bytes[0]!;
}

// Uint32Array erased: anything can ask an erased value for its `.buffer`.
export function erased(n: number): unknown {
  return new Uint32Array(n);
}

// A Float64Array window over another: `subarray` shares at the same kind, so
// Float64Array stays owned.
export function windowed(n: number): number {
  const xs = new Float64Array(n);
  xs[1] = 2.5;
  const window = xs.subarray(1);
  return window[0]!;
}

// An Int8Array passed where an ArrayBufferView is wanted: a call with no
// conversion in it, and the callee could ask for `.buffer`. Exposed.
function viewed(view: ArrayBufferView): number {
  return view.byteLength;
}
export function asABufferView(n: number): number {
  return viewed(new Int8Array(n));
}

// A Float64Array handed to a parameter typed Float64Array: still owned.
function first(xs: Float64Array): number {
  return xs[0]!;
}
export function handedOn(n: number): number {
  const xs = new Float64Array(n);
  return first(xs);
}
