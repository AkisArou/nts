import { decorate } from "./facade.js";

export function core(n: number): number {
  return n * 2;
}

export function decorated(n: number): number {
  return decorate(n);
}
