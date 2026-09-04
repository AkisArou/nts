// The timing surface for `bounce`.
//
// `innerBenchmarkLoop` is Are We Fast Yet's own driver, unchanged: it calls
// `benchmark()` and checks the answer against the constant the suite recorded.
// So a variant that is fast because it computes the wrong thing fails here
// rather than winning, independently of the runner's cross-variant checksum.
//
// The iteration count arrives opaque, so nothing about the workload folds.

import { Bounce } from "../../../awfy/src/bounce.ts";

export function work(iterations: number): number {
  const benchmark = new Bounce();
  return benchmark.innerBenchmarkLoop(iterations) ? 1 : 0;
}
