// `Towers#pushDisk`, guard and all.
//
// The guard is the whole point. It reads the slot, checks two things about what
// it found, and only then stores over it -- so the block that stores is reached
// by a *join*, and the take that would pair the read with the store has to
// survive one. `pile-shuffle` has the same push without the guard and is at its
// floor; this is what `awfy-towers` actually has.
//
// The arm that throws never runs here: the disks go on in decreasing size, as
// they must for the tower to be legal at all.

class Disk {
  size: number;
  next: Disk | null;
  constructor(size: number) {
    this.size = size;
    this.next = null;
  }
}

class Pile {
  top: Disk | null;
  constructor() {
    this.top = null;
  }

  push(disk: Disk): void {
    const top = this.top;
    if (top !== null && disk.size >= top.size) {
      throw new Error("Cannot put a big disk on a smaller one");
    }
    disk.next = top;
    this.top = disk;
  }
}

export function work(n: number): number {
  const pile = new Pile();
  for (let i = 16 + n; i >= 0; i = i - 1) {
    pile.push(new Disk(i));
  }
  let total = 0;
  let at = pile.top;
  while (at !== null) {
    total = total + at.size;
    at = at.next;
  }
  return total;
}
