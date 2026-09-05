// The timing surface for `towers`.
//
// `innerBenchmarkLoop` is Are We Fast Yet's own driver, unchanged: it calls
// `benchmark()` and checks the answer against the constant the suite recorded.
// So a variant that is fast because it computes the wrong thing fails here
// rather than winning, independently of the runner's cross-variant checksum.
//
// The iteration count arrives opaque, so nothing about the workload folds.

import { Benchmark } from "../../common/awfy-benchmark.ts";

// Ported from `benchmarks/JavaScript/towers.js`.

class TowersDisk {
  size: number;
  next: TowersDisk | null;

  constructor(size: number) {
    this.size = size;
    this.next = null;
  }
}

export class Towers extends Benchmark {
  piles: (TowersDisk | null)[] | null;
  movesDone: number;

  constructor() {
    super();
    this.piles = null;
    this.movesDone = 0;
  }

  override benchmark(): number {
    this.piles = new Array(3).fill(null);
    this.buildTowerAt(0, 13);
    this.movesDone = 0;
    this.moveDisks(13, 0, 1);
    return this.movesDone;
  }

  override verifyResult(result: number): boolean {
    return 8191 === result;
  }

  pushDisk(disk: TowersDisk, pile: number): void {
    const piles = this.piles!;
    const top = piles[pile];
    if (top !== null && disk.size >= top.size) {
      throw new Error("Cannot put a big disk on a smaller one");
    }

    disk.next = top;
    piles[pile] = disk;
  }

  popDiskFrom(pile: number): TowersDisk {
    const piles = this.piles!;
    const top = piles[pile];
    if (top === null) {
      throw new Error("Attempting to remove a disk from an empty pile");
    }

    piles[pile] = top.next;
    top.next = null;
    return top;
  }

  moveTopDisk(fromPile: number, toPile: number): void {
    this.pushDisk(this.popDiskFrom(fromPile), toPile);
    this.movesDone += 1;
  }

  buildTowerAt(pile: number, disks: number): void {
    for (let i = disks; i >= 0; i -= 1) {
      this.pushDisk(new TowersDisk(i), pile);
    }
  }

  moveDisks(disks: number, fromPile: number, toPile: number): void {
    if (disks === 1) {
      this.moveTopDisk(fromPile, toPile);
    } else {
      const otherPile = (3 - fromPile) - toPile;
      this.moveDisks(disks - 1, fromPile, otherPile);
      this.moveTopDisk(fromPile, toPile);
      this.moveDisks(disks - 1, otherPile, toPile);
    }
  }
}

export function work(iterations: number): number {
  const benchmark = new Towers();
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
