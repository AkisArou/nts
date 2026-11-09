// run: check
// The large-maximum form returns 302 in Node and -1 in nts. This pair
// differs only in maxByteLength: 16 or 2^31-1.
export function resize(): number {
  try {
    const buffer = new ArrayBuffer(4, {maxByteLength: 2147483647});
    const tracking = new Uint8Array(buffer);
    const fixed = tracking.subarray(0, 2);
    buffer.resize(3);
    return tracking.length * 100 + fixed.length;
  } catch (error) {
    return error instanceof RangeError ? -1 : -2;
  }
}
