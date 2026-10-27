// expect: an erased value where a concrete representation is wanted
//
// Reduced from AWFY Richards (2026-10-27): module-scope null sentinels
// (`const NO_WORK = null`) assigned into class-typed slots, compared,
// returned and used as an Array fill. Each use of the sentinel is the
// null value with no class in it, and lowering wants a concrete
// representation for it at the assignment (in the port the same root
// also surfaces as "a module-scope variable of a value that cannot
// exist" at the fill and comparison sites). Literal `null` at each
// site is the control:
// a-null-sentinel-written-literally-at-each-site.

const NO_WORK = null;
const NO_TASK = null;

class Packet {
  link: Packet | null;
  n: number;
  constructor(n: number) {
    this.link = NO_WORK;
    this.n = n;
  }
}

class Scheduler {
  taskTable: (Packet | null)[];
  constructor() {
    this.taskTable = new Array(3).fill(NO_TASK);
  }
  findTask(identity: number): Packet {
    const t = this.taskTable[identity];
    if (NO_TASK === t) {
      throw new Error("findTask failed");
    }
    return t;
  }
  release(identity: number): Packet | null {
    const t = this.taskTable[identity];
    if (NO_TASK === t) {
      return NO_TASK;
    }
    return t;
  }
}

export function run(seed: number): number {
  const s = new Scheduler();
  s.taskTable[1] = new Packet(7);
  return s.findTask(1).n + (s.release(0) === null ? 1 : 0) + ((seed | 0) & 1);
}
