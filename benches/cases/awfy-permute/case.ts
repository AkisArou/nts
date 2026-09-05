// The timing surface for `permute`.
//
// `innerBenchmarkLoop` is Are We Fast Yet's own driver, unchanged: it calls
// `benchmark()` and checks the answer against the constant the suite recorded.
// So a variant that is fast because it computes the wrong thing fails here
// rather than winning, independently of the runner's cross-variant checksum.
//
// The iteration count arrives opaque, so nothing about the workload folds.

import { Benchmark } from "../../common/awfy-benchmark.ts";

// Ported from `benchmarks/JavaScript/permute.js`.

export class Permute extends Benchmark {
  count: number;
  v: number[] | null;

  constructor() {
    super();
    this.count = 0;
    this.v = null;
  }

  override benchmark(): number {
    this.count = 0;
    this.v = new Array(6).fill(0);
    this.permute(6);
    return this.count;
  }

  override verifyResult(result: number): boolean {
    return result === 8660;
  }

  permute(n: number): void {
    this.count += 1;
    if (n !== 0) {
      const n1 = n - 1;
      this.permute(n1);
      for (let i = n1; i >= 0; i -= 1) {
        this.swap(n1, i);
        this.permute(n1);
        this.swap(n1, i);
      }
    }
  }

  swap(i: number, j: number): void {
    const v = this.v!;
    const tmp = v[i];
    v[i] = v[j];
    v[j] = tmp;
  }
}

export function work(iterations: number): number {
  const benchmark = new Permute();
  return benchmark.innerBenchmarkLoop(iterations) ? 1 : 0;
}

/**
 * The input the harness calls `work` with.
 *
 * Declared here because this is the only file that knows it. Every driver --
 * native, JVM and node -- is generated from this and the exported function
 * above, so the workload is stated once instead of once per lane. It is
 * `volatile` in each of them: a loop-invariant argument lets the optimiser
 * hoist the whole call out of the timed region and report an impressive zero.
 */
export const seed = 1;
