// The timing surface for `mandelbrot`.
//
// `innerBenchmarkLoop` is Are We Fast Yet's own driver, unchanged: it calls
// `benchmark()` and checks the answer against the constant the suite recorded.
// So a variant that is fast because it computes the wrong thing fails here
// rather than winning, independently of the runner's cross-variant checksum.
//
// The iteration count arrives opaque, so nothing about the workload folds.

import { Benchmark } from "../../common/awfy-benchmark.ts";

// Ported from `benchmarks/JavaScript/mandelbrot.js`.
//
// Originally from the Computer Language Benchmarks Game; see the header of the
// JavaScript source for its contributors and its BSD licence.

export class Mandelbrot extends Benchmark {
  mandelbrot(size: number): number {
    let sum = 0;
    let byteAcc = 0;
    let bitNum = 0;

    let y = 0;

    while (y < size) {
      const ci = ((2.0 * y) / size) - 1.0;
      let x = 0;

      while (x < size) {
        let zrzr = 0.0;
        let zi = 0.0;
        let zizi = 0.0;
        const cr = ((2.0 * x) / size) - 1.5;

        let z = 0;
        let notDone = true;
        let escape = 0;
        while (notDone && z < 50) {
          const zr = zrzr - zizi + cr;
          zi = 2.0 * zr * zi + ci;

          // preserve recalculation
          zrzr = zr * zr;
          zizi = zi * zi;

          if (zrzr + zizi > 4.0) {
            notDone = false;
            escape = 1;
          }
          z += 1;
        }

        byteAcc = (byteAcc << 1) + escape;
        bitNum += 1;

        // Code is very similar for these cases, but using separate blocks
        // ensures we skip the shifting when it's unnecessary, which is most cases.
        if (bitNum === 8) {
          sum ^= byteAcc;
          byteAcc = 0;
          bitNum = 0;
        } else if (x === size - 1) {
          byteAcc <<= (8 - bitNum);
          sum ^= byteAcc;
          byteAcc = 0;
          bitNum = 0;
        }
        x += 1;
      }
      y += 1;
    }
    return sum;
  }

  // The original verifies against the inner-iteration count, which is the size
  // it was run at. `innerBenchmarkLoop` passes it through.
  verifyAt(result: number, innerIterations: number): boolean {
    if (innerIterations === 500) { return result === 191; }
    if (innerIterations === 750) { return result === 50; }
    if (innerIterations === 1) { return result === 128; }
    return false;
  }

  override innerBenchmarkLoop(innerIterations: number): boolean {
    return this.verifyAt(this.mandelbrot(innerIterations), innerIterations);
  }
}

export function work(iterations: number): number {
  const benchmark = new Mandelbrot();
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
export const seed = 500;
