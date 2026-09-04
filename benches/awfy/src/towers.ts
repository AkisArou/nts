// Ported from `benchmarks/JavaScript/towers.js`.

import { Benchmark } from "./benchmark.ts";

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
