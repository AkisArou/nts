// `a` is evaluated *after* `b`: `main` imports `a`, `a` imports `b`, so the
// post-order walk reaches `b` first. `seed` therefore does not exist yet while
// `b`'s module body runs, which is the whole point of the pair.
import { readSeed } from "./b.js";

export let seed = 7;

export function bumpSeed(): void {
  seed += 1;
}

export function viaB(n: number): number {
  return readSeed() + n;
}
