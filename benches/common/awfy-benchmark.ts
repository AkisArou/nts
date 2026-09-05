// Ported from `benchmarks/JavaScript/benchmark.js`.
//
// The base class is part of the program's shape, not scaffolding around it:
// `innerBenchmarkLoop` calls `this.benchmark()` and `this.verifyResult()`
// through a `Benchmark` reference, so both are virtual calls that Are We Fast
// Yet means to measure. Flattening them into free functions would compile and
// would measure something else.
//
// `throw new Error('subclass responsibility')` is the original's way of saying
// abstract. It is kept rather than turned into an `abstract` member, because
// the two are not the same program: the throw is a real call site that a
// subclass overrides away, and an abstract method is a hole in the table.

export class Benchmark {
  innerBenchmarkLoop(innerIterations: number): boolean {
    for (let i = 0; i < innerIterations; i += 1) {
      if (!this.verifyResult(this.benchmark())) {
        return false;
      }
    }
    return true;
  }

  benchmark(): number {
    throw new Error("subclass responsibility");
  }

  verifyResult(result: number): boolean {
    throw new Error("subclass responsibility");
  }
}
