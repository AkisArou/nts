// The timing surface for `nbody`.
//
// `innerBenchmarkLoop` is Are We Fast Yet's own driver, unchanged: it calls
// `benchmark()` and checks the answer against the constant the suite recorded.
//
// The step count sits in *different places* on the two sides, and both do the
// same work. Are We Fast Yet's C++ port takes it as `inner_benchmark_loop`'s
// argument, so its reference runs that loop 250,000 times; ours is a constant
// inside `benchmark()`, the way every other port here holds its size, so the
// driver runs once. Either way it is 250,000 advances of five bodies followed
// by one energy check against the suite's recorded number.

import { NBody } from "../../../awfy/src/nbody.ts";

export function work(iterations: number): number {
  const benchmark = new NBody();
  return benchmark.innerBenchmarkLoop(iterations) ? 1 : 0;
}
