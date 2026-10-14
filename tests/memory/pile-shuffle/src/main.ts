// `awfy-towers` in miniature: a structure moved between array slots, and not
// one allocation in the loop that does the moving.
//
// Towers spends 8191 moves shuffling fourteen disks between three piles. It
// allocates nothing after the first fourteen, so nothing about allocation can
// reach it -- and it is the worst row in the benchmark table at 6.36x C++.
// What it spends is reference counting on *array elements*.
//
// `pop` reads `slots[at]` and overwrites that very slot on the next line, which
// is `load [take]` exactly. What stops it is the index: `taking` names a slot by
// its container and a *constant* index, and `at` is a parameter. Two reads of
// `slots[at]` with the same `at` are the same slot -- SSA says so -- and nothing
// currently says it.

class Disk {
  size: number;
  next: Disk | null;
  constructor(size: number) {
    this.size = size;
    this.next = null;
  }
}

class Piles {
  slots: (Disk | null)[];
  constructor() {
    this.slots = new Array<Disk | null>(3).fill(null);
  }

  push(disk: Disk, at: number): void {
    const here = this.slots;
    disk.next = here[at];
    here[at] = disk;
  }

  pop(at: number): Disk | null {
    const here = this.slots;
    const top = here[at];
    if (top === null) {
      return null;
    }
    here[at] = top.next;
    top.next = null;
    return top;
  }
}

export function work(n: number): number {
  const piles = new Piles();
  for (let i = 8 + n; i >= 0; i = i - 1) {
    piles.push(new Disk(i), 0);
  }
  let moves = 0;
  for (let k = 0; k < 64; k = k + 1) {
    const up = piles.pop(0);
    if (up !== null) {
      piles.push(up, 1);
      moves = moves + 1;
    }
    const back = piles.pop(1);
    if (back !== null) {
      piles.push(back, 0);
      moves = moves + 1;
    }
  }
  return moves;
}
