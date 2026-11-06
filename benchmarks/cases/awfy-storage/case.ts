// This code is derived from the SOM benchmarks, see AUTHORS.md file.
//
// Copyright (c) 2015-2016 Stefan Marr <git@stefan-marr.de>
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the 'Software'), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

// Upstream: https://github.com/smarr/are-we-fast-yet/blob/74306fec151070fd07157cefeacf19e7e0bcdc89/benchmarks/JavaScript/storage.js
// The timing surface for `storage`.
//
// `innerBenchmarkLoop` is Are We Fast Yet's own driver, unchanged: it calls
// `benchmark()` and checks the answer against the constant the suite recorded.
// So a variant that is fast because it computes the wrong thing fails here
// rather than winning, independently of the runner's cross-variant checksum.
//
// The iteration count arrives opaque, so nothing about the workload folds.

import { Benchmark } from "../../common/awfy-benchmark.ts";
import { Random } from "../../common/awfy-som.ts";

// Ported from `benchmarks/JavaScript/storage.js`.
//
// The tree is arrays of arrays, and a leaf is an array of holes whose length
// is all that is random about it. Nothing reads the tree back: the benchmark
// is the allocation, and the count of arrays is the answer.
type ArrayTree = ArrayTree[];

export class Storage extends Benchmark {
  declare count: number;

  constructor() {
    super();
    this.count = 0;
  }

  override benchmark(): number {
    const random = new Random();
    this.count = 0;
    this.buildTreeDepth(7, random);
    return this.count;
  }

  override verifyResult(result: number): boolean {
    return 5461 === result;
  }

  buildTreeDepth(depth: number, random: Random): ArrayTree {
    this.count += 1;
    if (depth === 1) {
      return new Array((random.next() % 10) + 1);
    }
    const arr: ArrayTree = new Array(4);
    for (let i = 0; i < 4; i += 1) {
      arr[i] = this.buildTreeDepth(depth - 1, random);
    }
    return arr;
  }
}

export function work(iterations: number): number {
  const benchmark = new Storage();
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
