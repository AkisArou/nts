// The timing surface for `list`.
//
// `innerBenchmarkLoop` is Are We Fast Yet's own driver, unchanged: it calls
// `benchmark()` and checks the answer against the constant the suite recorded.
// So a variant that is fast because it computes the wrong thing fails here
// rather than winning, independently of the runner's cross-variant checksum.
//
// The iteration count arrives opaque, so nothing about the workload folds.

import { Benchmark } from "../../common/awfy-benchmark.ts";

// Ported from `benchmarks/JavaScript/list.js`.

class Element {
  val: number;
  next: Element | null;

  constructor(v: number) {
    this.val = v;
    this.next = null;
  }

  length(): number {
    if (this.next === null) {
      return 1;
    }
    return 1 + this.next.length();
  }
}

export class List extends Benchmark {
  override benchmark(): number {
    const result = this.tail(this.makeList(15), this.makeList(10), this.makeList(6));
    // `tail` returns `z`, which the algorithm guarantees is a list rather than
    // the empty one. The original is untyped and says so by indexing it.
    return result!.length();
  }

  makeList(length: number): Element | null {
    if (length === 0) {
      return null;
    }
    const e = new Element(length);
    e.next = this.makeList(length - 1);
    return e;
  }

  isShorterThan(x: Element | null, y: Element | null): boolean {
    let xTail = x;
    let yTail = y;

    while (yTail !== null) {
      if (xTail === null) { return true; }
      xTail = xTail.next;
      yTail = yTail.next;
    }
    return false;
  }

  tail(x: Element | null, y: Element | null, z: Element | null): Element | null {
    if (this.isShorterThan(y, x)) {
      return this.tail(
        this.tail(x!.next, y, z),
        this.tail(y!.next, z, x),
        this.tail(z!.next, x, y)
      );
    }
    return z;
  }

  override verifyResult(result: number): boolean {
    return 10 === result;
  }
}

export function work(iterations: number): number {
  const benchmark = new List();
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
