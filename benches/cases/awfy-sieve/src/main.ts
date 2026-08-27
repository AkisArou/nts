// The timing surface for `sieve`.
//
// `innerBenchmarkLoop` is Are We Fast Yet's own driver, unchanged: it calls
// `benchmark()` and checks the answer against the constant the suite recorded.
// So a variant that is fast because it computes the wrong thing fails here
// rather than winning, independently of the runner's cross-variant checksum.
//
// The iteration count arrives opaque, so nothing about the workload folds.

import { Sieve } from "../../../awfy/src/sieve.ts";

export function work(iterations: number): number {
  const benchmark = new Sieve();
  return benchmark.innerBenchmarkLoop(iterations) ? 1 : 0;
}
