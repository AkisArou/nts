// Ported from `benchmarks/JavaScript/permute.js`.

import { Benchmark } from "./benchmark.ts";

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
