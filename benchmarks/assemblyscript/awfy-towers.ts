// Are We Fast Yet's Towers, transcribed to AssemblyScript.
import { Benchmark } from "./awfy";

class TowersDisk {
  size: i32;
  next: TowersDisk | null = null;

  constructor(size: i32) {
    this.size = size;
  }
}

class Towers extends Benchmark {
  piles: Array<TowersDisk | null> | null = null;
  movesDone: i32 = 0;

  benchmark(): f64 {
    this.piles = new Array<TowersDisk | null>(3).fill(null);
    this.buildTowerAt(0, 13);
    this.movesDone = 0;
    this.moveDisks(13, 0, 1);
    return this.movesDone;
  }

  verifyResult(result: f64): bool {
    return result == 8191;
  }

  pushDisk(disk: TowersDisk, pile: i32): void {
    const piles = this.piles!;
    const top = piles[pile];
    if (top !== null && disk.size >= top.size) {
      throw new Error("Cannot put a big disk on a smaller one");
    }
    disk.next = top;
    piles[pile] = disk;
  }

  popDiskFrom(pile: i32): TowersDisk {
    const piles = this.piles!;
    const top = piles[pile];
    if (top === null) {
      throw new Error("Attempting to remove a disk from an empty pile");
    }
    piles[pile] = top.next;
    top.next = null;
    return top;
  }

  moveTopDisk(fromPile: i32, toPile: i32): void {
    this.pushDisk(this.popDiskFrom(fromPile), toPile);
    this.movesDone += 1;
  }

  buildTowerAt(pile: i32, disks: i32): void {
    for (let i = disks; i >= 0; i -= 1) {
      this.pushDisk(new TowersDisk(i), pile);
    }
  }

  moveDisks(disks: i32, fromPile: i32, toPile: i32): void {
    if (disks == 1) {
      this.moveTopDisk(fromPile, toPile);
    } else {
      const otherPile = 3 - fromPile - toPile;
      this.moveDisks(disks - 1, fromPile, otherPile);
      this.moveTopDisk(fromPile, toPile);
      this.moveDisks(disks - 1, otherPile, toPile);
    }
  }
}

export function work(iterations: i32): i32 {
  return new Towers().innerBenchmarkLoop(iterations) ? 1 : 0;
}
