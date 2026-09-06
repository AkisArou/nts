// `DataView`: a window on an `ArrayBuffer` with explicit endianness.
//
// EVERY CASE CATCHES, for the reason `array-buffer` gives: an uncaught throw
// ends the process and every case after it goes unasked, so catching turns each
// throw into a compared answer and the run continues.
//
// The default is **big-endian**, which is the one place in the language where
// the default is the less common byte order. Half of these cases pass no
// `littleEndian` argument for that reason.

const RANGE = -1;
const TYPE = -2;
const OTHER = -3;

function thrown(error: unknown): number {
  if (error instanceof RangeError) {
    return RANGE;
  }
  if (error instanceof TypeError) {
    return TYPE;
  }
  return OTHER;
}

function bounded(n: number): number {
  return n > 4096 ? 4096 : n;
}

export function roundTripUint8(n: number): number {
  try {
    const view = new DataView(new ArrayBuffer(8));
    view.setUint8(0, n);
    return view.getUint8(0);
  } catch (error) {
    return thrown(error);
  }
}

export function roundTripInt32(n: number, little: boolean): number {
  try {
    const view = new DataView(new ArrayBuffer(8));
    view.setInt32(0, n, little);
    return view.getInt32(0, little);
  } catch (error) {
    return thrown(error);
  }
}

// The endianness actually reaches the bytes: written one way and read the
// other, the answer differs, and that is what the pair proves.
export function endiannessMatters(n: number): number {
  try {
    const view = new DataView(new ArrayBuffer(8));
    view.setUint32(0, n, true);
    return view.getUint32(0, false);
  } catch (error) {
    return thrown(error);
  }
}

export function defaultIsBigEndian(n: number): number {
  try {
    const view = new DataView(new ArrayBuffer(8));
    view.setUint16(0, n);
    return view.getUint16(0, false);
  } catch (error) {
    return thrown(error);
  }
}

export function roundTripFloat64(n: number): number {
  try {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, n, true);
    return view.getFloat64(0, true);
  } catch (error) {
    return thrown(error);
  }
}

// Rounds to nearest even and keeps a NaN's payload; the value read back is not
// the value written unless it was representable.
export function roundTripFloat32(n: number): number {
  try {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat32(0, n, true);
    return view.getFloat32(0, true);
  } catch (error) {
    return thrown(error);
  }
}

// Unaligned access is legal, which is the whole difference from a typed array.
export function unaligned(n: number): number {
  try {
    const view = new DataView(new ArrayBuffer(16));
    view.setFloat64(1, n, true);
    return view.getFloat64(1, true);
  } catch (error) {
    return thrown(error);
  }
}

export function pastTheEnd(at: number): number {
  try {
    const view = new DataView(new ArrayBuffer(8));
    return view.getFloat64(bounded(at));
  } catch (error) {
    return thrown(error);
  }
}

export function shape(offset: number, length: number): number {
  try {
    const buffer = new ArrayBuffer(16);
    const view = new DataView(buffer, bounded(offset), bounded(length));
    return view.byteOffset * 100 + view.byteLength;
  } catch (error) {
    return thrown(error);
  }
}

export function tracksTheBuffer(offset: number): number {
  try {
    const buffer = new ArrayBuffer(16);
    const view = new DataView(buffer, bounded(offset));
    return view.byteLength;
  } catch (error) {
    return thrown(error);
  }
}

export function sameBuffer(n: number): number {
  try {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint8(0, n);
    return new DataView(view.buffer).getUint8(0);
  } catch (error) {
    return thrown(error);
  }
}

export function overADetachedBuffer(n: number): number {
  try {
    const buffer = new ArrayBuffer(8);
    buffer.transfer();
    const view = new DataView(buffer);
    return view.getUint8(bounded(n));
  } catch (error) {
    return thrown(error);
  }
}

// The bigint pair, whose element is 64 bits where a bigint is 128. A read
// sign-extends into the high half or zero-fills it -- that is the whole
// difference between them -- and a write keeps the low half either way, so the
// two stores are identical and only the reads differ.
//
// Returned as a number so the differential can compare it: the pool is doubles
// and a bigint result would have nothing to be compared against.
export function roundTripBigInt64(n: number): number {
  try {
    const view = new DataView(new ArrayBuffer(16));
    view.setBigInt64(0, BigInt(Math.trunc(bounded(n))), true);
    return Number(view.getBigInt64(0, true));
  } catch (error) {
    return thrown(error);
  }
}

// The same bits read the other way.
//
// **Shifted into the top half deliberately.** The pool is bounded to 4,096, so
// a value written as-is never sets bit 63 and the signed and unsigned reads
// agree on every case -- which made the first version of this pass with the
// unsigned accessor sign-extending. The shift is what puts the distinguishing
// state in reach, and it is the same lesson as putting exact halves in a
// rounding pool.
export function signedAgainstUnsigned(n: number): number {
  try {
    const view = new DataView(new ArrayBuffer(16));
    // Both states, chosen by the pool value rather than hoped for. Shifting
    // alone does not reach bit 63 for a pool bounded to 4,096 -- the second
    // version of this still passed with the unsigned accessor sign-extending,
    // for that reason and not the first one.
    const base = BigInt(Math.trunc(bounded(n)));
    const top = base % 2n === 0n ? 0x8000000000000000n : 0n;
    const high = BigInt.asUintN(64, (base << 8n) | top);
    view.setBigInt64(0, BigInt.asIntN(64, high), false);
    const signed = view.getBigInt64(0, false);
    const unsigned = view.getBigUint64(0, false);
    // Their difference is 2^64 exactly when the top bit is set, and zero
    // otherwise -- so this reports *which* it was rather than merely that they
    // differed.
    return Number((unsigned - signed) >> 32n);
  } catch (error) {
    return thrown(error);
  }
}

export function bigEndiannessMatters(n: number): number {
  try {
    const view = new DataView(new ArrayBuffer(16));
    view.setBigUint64(0, BigInt(Math.trunc(bounded(n))), true);
    return Number(view.getBigUint64(0, false) & 0xffffn);
  } catch (error) {
    return thrown(error);
  }
}
