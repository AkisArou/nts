// Ported from `benchmarks/JavaScript/sieve.js`.

import { Benchmark } from "./benchmark.ts";

export class Sieve extends Benchmark {
  sieve(flags: boolean[], size: number): number {
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

  override benchmark(): number {
    const flags: boolean[] = new Array(5000);
    flags.fill(true);
    return this.sieve(flags, 5000);
  }

  override verifyResult(result: number): boolean {
    return 669 === result;
  }
}
