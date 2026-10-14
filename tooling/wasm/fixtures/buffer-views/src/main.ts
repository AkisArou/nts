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

// A subarray is a window on the same bytes at the same kind: a write through
// it is a write to the original, and its byteLength is its own width's.
export function windows(v: number): number {
  const halves = new Uint16Array(8);
  for (let i = 0; i < 8; i++) halves[i] = i * 1000 + 7;
  const from = (v | 0) % 10;
  const cut = halves.subarray(from, -2);
  if (cut.length > 0) cut[0] = 65535;
  let total = 0;
  for (let i = 0; i < 8; i++) total = total * 3 + halves[i]!;
  return total % 1000000007 + cut.length * 0.5 + cut.byteLength * 0.001 + cut.byteOffset * 10000;
}

// A slice is a copy: writing the original afterwards leaves it alone.
export function copies(v: number): number {
  const ints = new Int32Array(6);
  for (let i = 0; i < 6; i++) ints[i] = i * (v | 0);
  const copy = ints.slice(1, (v | 0) % 7);
  ints[2] = 99;
  let total = 0;
  for (let i = 0; i < copy.length; i++) total = total * 5 + copy[i]!;
  return total + copy.length * 1000000;
}

// `set` converts values between kinds, and reads a snapshot when both share a
// buffer: the wider destination would overwrite bytes not yet read.
export function setsAcrossKinds(v: number): number {
  const buffer = new ArrayBuffer(16);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < 16; i++) bytes[i] = i * 17 + (v | 0);
  const halves = new Uint16Array(buffer);
  halves.set(bytes.subarray(0, 6), 1);
  const singles = new Float32Array(4);
  const ints = new Int32Array(4);
  for (let i = 0; i < 4; i++) ints[i] = (i - 2) * (v | 0) * 1000;
  singles.set(ints);
  let total = 0;
  for (let i = 0; i < 8; i++) total = total * 7 + halves[i]!;
  return total % 1000000007 + singles[0]! * 0.001 + singles[3]!;
}

// The same kind moves bytes, overlapping too.
export function setsWithinOneKind(v: number): number {
  const bytes = new Uint8Array(12);
  for (let i = 0; i < 12; i++) bytes[i] = i + (v | 0);
  bytes.set(bytes.subarray(0, 8), 3);
  let total = 0;
  for (let i = 0; i < 12; i++) total = total * 3 + bytes[i]!;
  return total;
}

export function fills(v: number): number {
  const bytes = new Uint8Array(10);
  bytes.fill(v, 2, -3);
  const halves = new Int16Array(6);
  halves.fill(v * 1000, -4);
  const doubles = new Float64Array(3);
  doubles.fill(v / 3, 1);
  let total = 0;
  for (let i = 0; i < 10; i++) total = total * 3 + bytes[i]!;
  for (let i = 0; i < 6; i++) total = total * 3 + halves[i]!;
  return total % 1000000007 + doubles[1]! + doubles[0]!;
}

// copyWithin reads what it has already written when the ranges overlap.
export function copiesWithin(v: number): number {
  const ints = new Int32Array(8);
  for (let i = 0; i < 8; i++) ints[i] = i * 11 + (v | 0);
  ints.copyWithin(2, 0, 5);
  ints.copyWithin(-2, -6, (v | 0) % 9);
  let total = 0;
  for (let i = 0; i < 8; i++) total = total * 5 + ints[i]!;
  return total % 1000000007;
}

export function joins(v: number): string {
  const singles = new Float32Array(3);
  singles[0] = v;
  singles[1] = 0.1;
  singles[2] = -2.5;
  const bytes = new Int8Array(2);
  bytes[0] = -v;
  return singles.join("|") + "/" + bytes.join();
}

// A buffer's slice copies the bytes between ends counted from the back too.
export function bufferSlices(v: number): number {
  const buffer = new ArrayBuffer(10);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < 10; i++) bytes[i] = i + 1;
  const cut = buffer.slice((v | 0) % 12, -1);
  const view = new Uint8Array(cut);
  bytes[5] = 200;
  let total = 0;
  for (let i = 0; i < view.length; i++) total = total * 3 + view[i]!;
  return total + cut.byteLength * 100000;
}

// transfer moves the bytes and detaches the old buffer: its length, and every
// view over it, read 0. Growing zero-fills; a resizable one keeps its maximum.
export function transfers(v: number): number {
  const size = (v | 0) & 15;
  const old = new ArrayBuffer(8, { maxByteLength: 32 });
  const before = new Uint8Array(old);
  for (let i = 0; i < 8; i++) before[i] = i + 10;
  const moved = old.transfer(size);
  const after = new Uint8Array(moved);
  let total = 0;
  for (let i = 0; i < after.length; i++) total = total * 3 + after[i]!;
  const fixed = moved.transferToFixedLength(4);
  return total + old.byteLength * 1000 + before.length * 100 + (old.detached ? 0.5 : 0)
    + moved.maxByteLength * 0.001 + fixed.maxByteLength * 10000000 + (fixed.resizable ? 0.25 : 0);
}

// A DataView chooses width and byte order per access, at any offset. What it
// writes big-endian a typed array over the same bytes reads little-endian.
export function dataViewOrders(v: number): number {
  if (v !== v) return -1; // NaN's bits are the implementation's to choose.
  const buffer = new ArrayBuffer(24);
  const view = new DataView(buffer, 1);
  view.setFloat64(1, v);
  view.setUint16(10, v * 7 + 3, true);
  view.setInt32(13, v * 1000);
  view.setFloat32(18, v, true);
  const bytes = new Uint8Array(buffer);
  let total = 0;
  for (let i = 0; i < 24; i++) total = (total * 3 + bytes[i]!) % 1000000007;
  return total + view.getInt16(10) * 0.5 + view.getUint32(13, true) * 0.001
    + view.getFloat64(1) + view.getFloat32(18, true) + view.getInt8(2);
}

// A tracking view follows a resize; a fixed one keeps its length.
export function dataViewLengths(v: number): number {
  const steps = ((v | 0) & 7) + 4;
  const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
  const tracking = new DataView(buffer, 2);
  const fixed = new DataView(buffer, 1, 3);
  buffer.resize(steps);
  return tracking.byteLength * 100 + fixed.byteLength * 10 + fixed.byteOffset
    + (fixed.buffer === buffer ? 0.5 : 0);
}

// DataView's 64-bit bigint accessors: both byte orders, a negative value, the
// top bit set (signed and unsigned reads disagree there), and the low 64 bits
// of a value wider than a word kept on the way in.
export function bigint64(v: number): string {
  const view = new DataView(new ArrayBuffer(24));
  const k = BigInt(v | 0);
  view.setBigInt64(0, k * 1000003n - 7n, (v | 0) % 2 === 0);
  view.setBigUint64(8, (1n << 63n) + k * 3n, true);
  view.setBigInt64(16, (1n << 70n) + k, false);
  return `${view.getBigInt64(0, (v | 0) % 2 === 0)}|${view.getBigUint64(0, false)}|${view.getBigInt64(8, true)}|${view.getBigUint64(8, true)}|${view.getBigInt64(16, false)}|${view.getUint8(15)}`;
}

// `Array.from` over a typed array walks it to its length (C's
// `nts_view_length`): of each element kind, and of a view that tracks a buffer
// which grew.
export function arraysFromViews(v: number): number {
  const bytes = new Uint8Array([1, 2, v & 0xff]);
  const words = new Int16Array([-2, v & 0x7fff]);
  const floats = new Float64Array([0.5, v]);
  const buffer = new ArrayBuffer(2, { maxByteLength: 8 });
  const tracking = new Uint8Array(buffer);
  buffer.resize(v > 0 && v < 7 ? Math.floor(v) + 1 : 5);
  tracking[0] = 9;
  const a = Array.from(bytes);
  const b = Array.from(words);
  const c = Array.from(floats);
  const d = Array.from(tracking);
  return a.length * 1000 + a[2]! + b[0]! * 10 + b.length * 100 + c[1]! + c.length + d.length * 100000 + d[0]!;
}
