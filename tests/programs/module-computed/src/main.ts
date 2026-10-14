import { base, doubled, once } from "./table.js";

export function readBase(n: number): number {
  return base + n;
}

export function readDoubled(n: number): number {
  return doubled + n;
}

export function readOnce(n: number): number {
  return once + once + n;
}
