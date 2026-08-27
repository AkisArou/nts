// Ported from `benchmarks/JavaScript/storage.js`.
//
// The original builds a tree of `Object[]` whose elements are themselves
// `Object[]`, which in TypeScript is a *recursive* array type. That is the
// whole point of the benchmark from a compiler's side: allocating five
// thousand arrays whose element type refers back to the array, so a
// representation that recurses on its own definition never terminates.

import { Benchmark } from "./benchmark.ts";
import { Random } from "./som.ts";

type Tree = Tree[];

export class Storage extends Benchmark {
  count: number;

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

  buildTreeDepth(depth: number, random: Random): Tree {
    this.count += 1;
    if (depth === 1) {
      return new Array<Tree>((random.next() % 10) + 1);
    }
    const arr = new Array<Tree>(4);
    for (let i = 0; i < 4; i += 1) {
      arr[i] = this.buildTreeDepth(depth - 1, random);
    }
    return arr;
  }
}
