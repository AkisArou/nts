function combine([value]: number[], offset: number, scale: number): number {
  return value + offset * 10 + scale;
}
function skip([value]: number[], ignored: number, offset: number): number {
  return value + offset;
}
export function ordered(n: number): number { return combine([n], 2, 3); }
export function swapped(n: number): number { return combine([n], 3, 2); }
export function unused(n: number): number { return skip([n], 99, 5); }
export function direct([value]: number[], offset: number, scale: number): number {
  return value + offset * 10 + scale;
}
