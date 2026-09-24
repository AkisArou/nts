// Count leading zeros of a 32-bit integer.
//
// `Math.clz32` is not in NTS's `Math` (requested); a binary search over the
// bits gives the same answer in five steps. Lanes are small bit sets, so this
// sits on the scheduling path and stays branch-light.
export function clz32(input: number): number {
  let x = input >>> 0;
  if (x === 0) {
    return 32;
  }
  let n = 0;
  if ((x & 0xffff0000) === 0) {
    n += 16;
    x = (x << 16) >>> 0;
  }
  if ((x & 0xff000000) === 0) {
    n += 8;
    x = (x << 8) >>> 0;
  }
  if ((x & 0xf0000000) === 0) {
    n += 4;
    x = (x << 4) >>> 0;
  }
  if ((x & 0xc0000000) === 0) {
    n += 2;
    x = (x << 2) >>> 0;
  }
  if ((x & 0x80000000) === 0) {
    n += 1;
  }
  return n;
}
