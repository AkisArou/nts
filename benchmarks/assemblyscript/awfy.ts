// Are We Fast Yet's harness and its SOM helpers, transcribed to AssemblyScript
// for the benchmark table's `AssemblyScript` column: the same algorithms, the
// same checksums, in the types AWFY's own C++ and Java ports use.
//
// `benchmark` answers an `f64` in every case, which holds each case's result
// exactly -- an integer count, or nbody's energy -- so one base serves all
// eight, as AWFY's `Benchmark` does.

export class Benchmark {
  innerBenchmarkLoop(innerIterations: i32): bool {
    for (let i = 0; i < innerIterations; i += 1) {
      if (!this.verifyResult(this.benchmark())) {
        return false;
      }
    }
    return true;
  }

  benchmark(): f64 {
    throw new Error("subclass responsibility");
  }

  verifyResult(result: f64): bool {
    throw new Error("subclass responsibility");
  }
}

export class Random {
  seed: i32 = 74755;

  next(): i32 {
    this.seed = (this.seed * 1309 + 13849) & 65535;
    return this.seed;
  }
}
