export function literalFirst(n: 0): 1;
export function literalFirst(n: number): number;
export function literalFirst(n: number): number {
  if (n < 0) {
    throw new RangeError("literal first");
  }
  return n * 4 + 1;
}

export function broadFirst(n: number): number;
export function broadFirst(n: 0): 1;
export function broadFirst(n: number): number {
  if (n < 0) {
    throw new RangeError("broad first");
  }
  return n * 4 + 1;
}
