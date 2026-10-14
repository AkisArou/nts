// expect: NTS1003 `held` cannot be compiled because it reads `holder`, which a module statement evaluation skips would have assigned
//
// A module-scope `const holder = new Holder(refused())` whose argument is
// refused: excision cut the constructor call and left the allocation and the
// store, so `holder` held an object no constructor wrote, and `held()` read
// its never-written field -- a null where a function was, SIGSEGV. A doomed
// constructor dooms the allocation it was to fill (`doomed_values`), so the
// store is cut and `holder` is stale: its readers are refused.
//
// **A guard from the day it was written (2026-10-08)**, by MainClaude,
// re-derived from Codex 3e0d29f34.
//
// Control in the same program: `control` reads a holder whose constructor
// ran, and agrees with node.
class Picker {
  pick<T>(value: T): T {
    return value;
  }
}

function refused(): (n: number) => number {
  return new Picker().pick<(n: number) => number>((n) => n + 1);
}

class Holder {
  readonly callback: (n: number) => number;
  constructor(callback: (n: number) => number) {
    this.callback = callback;
  }
}

const holder = new Holder(refused());
const good = new Holder((n) => n * 2);

export function held(n: number): number {
  return holder.callback(n);
}

export function control(n: number): number {
  return good.callback(n);
}
