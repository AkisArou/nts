import { fromB } from "./b.js";

export function fromA(): number {
  return fromB() + 1;
}

export function startA(n: number): number {
  return fromA() + n;
}
