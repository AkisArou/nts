// expect: NTS1003 `observed` cannot be compiled because it reads `actual`, which a module statement evaluation skips would have assigned
//
// A module statement evaluation skips leaves every global it assigns holding
// whatever it held before -- and a static initializer does not make that
// right. `export let actual = 0` reassigned by `try { actual = early(3) }
// catch { actual = 7 }`, with `early` refused (it calls a generic method
// returning its type parameter), lost the store that runs and kept the
// catch's: `observed` and `through` compiled and answered from 0 where node
// answers from 3 -- 56 of 58 cases. Their readers are refused now
// (`Lowered::stale_globals`).
//
// **Kept as a guard from the day it was written (2026-10-08)**, by MainClaude,
// re-derived from Codex 76e5272ef.
//
// Controls in the same program: `intact` reads a global nothing cut, and
// `independent` reads none; both still compile and agree with node.
export let actual = 0;
try {
  actual = early(3);
} catch {
  actual = 7;
}

class Picker {
  pick<T>(value: T): T {
    return value;
  }
}

function early(n: number): number {
  return new Picker().pick<number>(n);
}

export function observed(n: number): number {
  return actual + n;
}

export function through(n: number): number {
  return observed(n) * 2;
}

let untouched = 11;

export function intact(n: number): number {
  return untouched + n;
}

export function independent(n: number): number {
  return n + 7;
}
