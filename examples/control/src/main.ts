export function max(a: number, b: number): number {
  if (a > b) {
    return a;
  }
  return b;
}

export function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) {
    return lo;
  } else if (n > hi) {
    return hi;
  } else {
    return n;
  }
}
