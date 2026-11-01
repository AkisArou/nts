// Control: the same function with `number[]` for `ArrayLike<number>`.
function size(value: number): number;
function size(value: string): number;
function size(value: number[]): number;
function size(value: number | string | number[]): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return value.length * 10;
  return value.length * 100;
}
export function fromNumber(n: number): number {
  return size(n);
}
export function fromString(n: number): number {
  return size("ab".repeat((n & 3) + 1));
}
export function fromArray(n: number): number {
  return size([n, n + 1, n + 2]);
}
