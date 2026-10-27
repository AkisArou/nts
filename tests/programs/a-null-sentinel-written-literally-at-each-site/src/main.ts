// The control for a-module-scope-null-sentinel-assigned-to-class-slots
// (tests/refusals): the same program with `null` written literally at
// each site instead of through module-scope constants. Agrees
// everywhere, measured 2026-10-27.

class Packet {
  link: Packet | null;
  n: number;
  constructor(n: number) {
    this.link = null;
    this.n = n;
  }
}

class Scheduler {
  taskTable: (Packet | null)[];
  constructor() {
    this.taskTable = new Array(3).fill(null);
  }
  findTask(identity: number): Packet {
    const t = this.taskTable[identity];
    if (null === t) {
      throw new Error("findTask failed");
    }
    return t;
  }
  release(identity: number): Packet | null {
    const t = this.taskTable[identity];
    if (null === t) {
      return null;
    }
    return t;
  }
}

export function run(seed: number): number {
  const s = new Scheduler();
  s.taskTable[1] = new Packet(7);
  return s.findTask(1).n + (s.release(0) === null ? 1 : 0) + ((seed | 0) & 1);
}
