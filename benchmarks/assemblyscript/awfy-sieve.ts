// Are We Fast Yet's Sieve, transcribed to AssemblyScript.
import { Benchmark } from "./awfy";

class Sieve extends Benchmark {
  sieve(flags: Array<bool>, size: i32): i32 {
    let primeCount = 0;
    for (let i = 2; i <= size; i += 1) {
      if (flags[i - 1]) {
        primeCount += 1;
        let k = i + i;
        while (k <= size) {
          flags[k - 1] = false;
          k += i;
        }
      }
    }
    return primeCount;
  }

  benchmark(): f64 {
    const flags = new Array<bool>(5000);
    flags.fill(true);
    return this.sieve(flags, 5000);
  }

  verifyResult(result: f64): bool {
    return result == 669;
  }
}

export function work(iterations: i32): i32 {
  return new Sieve().innerBenchmarkLoop(iterations) ? 1 : 0;
}
