// One buffer, many views: what a view writes, every other view over the same
// bytes reads, at its own width and little-endian. Wasm keeps a buffer's bytes
// in one GC byte array and assembles a wider element from them, so each
// export below crosses widths and offsets, and compares against node.

// A double written whole, read back a byte at a time: the order is the
// assertion. Each byte is weighted by its place, so a reversed or shifted
// read gives a different number.
export function doubleAsBytes(v: number): number {
  if (v !== v) return -1; // NaN's bits are the implementation's to choose.
  const buffer = new ArrayBuffer(24);
  const doubles = new Float64Array(buffer);
  doubles[1] = v;
  const bytes = new Uint8Array(buffer);
  let total = 0;
  for (let i = 0; i < 24; i++) {
    total = total * 3 + bytes[i]!;
    total = total % 1000000007;
  }
  return total;
}

// The other way: bytes written one at a time, read at every wider width,
// from an offset that is not a multiple of the width.
export function bytesAsWider(v: number): number {
  const buffer = new ArrayBuffer(16);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < 16; i++) {
    bytes[i] = v * (i + 1) + i * 37;
  }
  const halves = new Uint16Array(buffer, 2, 3);
  const signed = new Int16Array(buffer, 4, 2);
  const words = new Uint32Array(buffer, 4, 2);
  const ints = new Int32Array(buffer, 8, 2);
  return halves[2]! + signed[1]! * 3 + words[1]! % 65521 + ints[0]! % 4093;
}

// A float32 store rounds; its bits, read through a Uint32Array over the same
// bytes, say how. And a negative zero keeps its sign through both.
export function singleBits(v: number): number {
  if (v !== v) return -1;
  const buffer = new ArrayBuffer(8);
  const singles = new Float32Array(buffer);
  singles[1] = v;
  const bits = new Uint32Array(buffer);
  return bits[1]! + (Object.is(singles[1], -0) ? 0.5 : 0);
}

export function singleRoundTrip(v: number): number {
  const singles = new Float32Array(2);
  singles[0] = v;
  return singles[0]!;
}

// Signed and unsigned halves of one word.
export function halvesOfAWord(v: number): number {
  const buffer = new ArrayBuffer(4);
  new Int32Array(buffer)[0] = v;
  const unsigned = new Uint16Array(buffer);
  const signed = new Int16Array(buffer);
  const bytes = new Int8Array(buffer);
  return unsigned[0]! * 100000 + signed[1]! + bytes[3]! * 0.25;
}

// A tracking view follows its buffer through a resize; a view cut to a fixed
// window reads as empty while the window does not fit, and is back when the
// buffer grows again. Bytes a shrink dropped come back as zeroes.
export function acrossAResize(v: number): number {
  const steps = v > 0 && v < 8 ? Math.floor(v) : 3;
  const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
  const whole = new Uint8Array(buffer);
  const window = new Uint8Array(buffer, 4, 4);
  whole[7] = 255;
  buffer.resize(steps);
  const shrunk = whole.length * 100 + window.length * 10;
  buffer.resize(12);
  return shrunk * 1000 + whole.length * 10 + window.length + whole[7]! * 0.5
    + (buffer.resizable ? 0.25 : 0) + buffer.maxByteLength * 10000000;
}

// Lengths, offsets and the buffer a view names.
export function shapes(v: number): number {
  const size = v >= 1 && v < 64 ? Math.floor(v) : 8;
  const buffer = new ArrayBuffer(size * 8);
  const doubles = new Float64Array(buffer, 8);
  const halves = new Uint16Array(buffer, 2, size);
  return doubles.length * 1000000 + doubles.byteLength * 1000 + halves.byteOffset * 10
    + halves.byteLength + (halves.buffer === buffer ? 0.5 : 0) + buffer.byteLength * 0.001;
}

function kindOf(value: unknown): number {
  if (value instanceof Uint8Array) return 1;
  if (value instanceof Float64Array) return 2;
  if (value instanceof ArrayBuffer) return 3;
  if (ArrayBuffer.isView(value)) return 4;
  return 0;
}

// What an open value is, asked at run time. The ordinary array holds strings:
// a `number[]` literal anywhere in the program makes the core compute
// `bytesAsWider`'s signed remainder as unsigned, on C and Wasm alike (pinned
// in tooling/conformance/outcomes/a-negative-int32-element-read-as-unsigned).
export function kinds(v: number): number {
  const which = v > 0 && v < 6 ? Math.floor(v) : 0;
  const values: unknown[] = [
    new Uint8Array(2),
    new Float64Array(2),
    new ArrayBuffer(2),
    new Int16Array(2),
    ["an", "array"],
    "bytes",
  ];
  return kindOf(values[which]) * 10 + which;
}

// Integer counters stored straight in: negative and past the width, so the
// narrowing of an int32 that was never a fraction wraps as ToInt32 does.
export function countersWrap(v: number): number {
  const bytes = new Uint8Array(8);
  const signed = new Int8Array(8);
  const halves = new Int16Array(8);
  const start = (v | 0) & 255;
  for (let i = start - 400; i < start + 400; i += 37) {
    bytes[i & 7] = i;
    signed[i & 7] = i * 3;
    halves[i & 7] = i * 1000;
  }
  let total = 0;
  for (let i = 0; i < 8; i++) {
    total = total * 7 + bytes[i]! + signed[i]! * 3 + halves[i]! * 0.5;
    total = total % 1000000007;
  }
  return total;
}
