// What each benchmark computes, once.
//
// This is the correctness surface rather than the timing one: every function
// here takes no arguments, so `nts check` runs it under node and compares the
// bit patterns. A benchmark's own `verifyResult` checks the same number against
// the constant Are We Fast Yet recorded, which catches all implementations
// being wrong together; this catches ours being wrong alone.

import { Bounce } from "./bounce.ts";
import { List } from "./list.ts";
import { Mandelbrot } from "./mandelbrot.ts";
import { NBody } from "./nbody.ts";
import { Permute } from "./permute.ts";
import { Queens } from "./queens.ts";
import { Sieve } from "./sieve.ts";
import { Storage } from "./storage.ts";
import { Towers } from "./towers.ts";

export function bounceResult(): number {
  return new Bounce().benchmark();
}

export function listResult(): number {
  return new List().benchmark();
}

export function mandelbrotResult(): number {
  return new Mandelbrot().mandelbrot(500);
}

export function nbodyResult(): number {
  return new NBody().benchmark();
}

export function permuteResult(): number {
  return new Permute().benchmark();
}

export function queensResult(): number {
  return new Queens().benchmark();
}

export function sieveResult(): number {
  return new Sieve().benchmark();
}

export function storageResult(): number {
  return new Storage().benchmark();
}

export function towersResult(): number {
  return new Towers().benchmark();
}
