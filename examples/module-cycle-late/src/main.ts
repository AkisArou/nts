import { bumpSeed, viaB } from "./a.js";

bumpSeed();

export function lateRead(n: number): number {
  return viaB(n);
}
