// `| 0` is how integer intent is written in JavaScript. It is a proof: whatever
// `x` was, the result is a whole number inside int32.
export function toInt(x: number): number {
  return x | 0;
}

// A mask bounds the result to [0, 1023] regardless of the input.
export function bucket(hash: number): number {
  return hash & 1023;
}

export function mix(a: number, b: number): number {
  return ((a ^ b) << 3) >>> 1;
}

export function isEven(n: number): boolean {
  return (n & 1) === 0;
}
