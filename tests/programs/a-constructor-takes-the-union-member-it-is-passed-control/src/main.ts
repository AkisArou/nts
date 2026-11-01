// Control: the same constructor with `number[]` for `ArrayLike<number>`.
class Sized {
  readonly size: number;
  constructor(value: number);
  constructor(value: string);
  constructor(value: number[]);
  constructor(value: number | string | number[]) {
    if (typeof value === "number") {
      this.size = value;
      return;
    }
    if (typeof value === "string") {
      this.size = value.length * 10;
      return;
    }
    this.size = value.length * 100;
  }
}
export function fromNumber(n: number): number {
  return new Sized(n).size;
}
export function fromString(n: number): number {
  return new Sized("ab".repeat((n & 3) + 1)).size;
}
export function fromArray(n: number): number {
  return new Sized([n, n + 1]).size;
}
