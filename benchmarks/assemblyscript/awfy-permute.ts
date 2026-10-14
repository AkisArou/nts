// Are We Fast Yet's Permute, transcribed to AssemblyScript.
import { Benchmark } from "./awfy";

class Permute extends Benchmark {
  count: i32 = 0;
  v: Array<i32> | null = null;

  benchmark(): f64 {
    this.count = 0;
    this.v = new Array<i32>(6).fill(0);
    this.permute(6);
    return this.count;
  }

  verifyResult(result: f64): bool {
    return result == 8660;
  }

  permute(n: i32): void {
    this.count += 1;
    if (n != 0) {
      const n1 = n - 1;
      this.permute(n1);
      for (let i = n1; i >= 0; i -= 1) {
        this.swap(n1, i);
        this.permute(n1);
        this.swap(n1, i);
      }
    }
  }

  swap(i: i32, j: i32): void {
    const v = this.v!;
    const tmp = v[i];
    v[i] = v[j];
    v[j] = tmp;
  }
}

export function work(iterations: i32): i32 {
  return new Permute().innerBenchmarkLoop(iterations) ? 1 : 0;
}
