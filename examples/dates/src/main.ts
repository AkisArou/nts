// A `Date` is a millisecond offset from the epoch, and nothing else.
//
// The specification calls its contents a *time value* and defines every
// accessor as arithmetic on it, so the object is a header and a double. That is
// the whole representation, and everything below follows from it.
//
// What is deliberately absent: `Date.now()` and `new Date()` with no argument.
// Both read a wall clock, and **no differential could check them** — node would
// answer with its instant and this with a later one. They are refused by name
// rather than approximated, for the same reason `Math.random` is absent.
//
// The pool makes these arguments negative, fractional and enormous, which is
// what exercises `TimeClip`.

export function roundTrips(ms: number): number {
  return new Date(ms).getTime();
}

// `valueOf` and `getTime` are one operation under two names.
export function valueOfAgrees(ms: number): number {
  const d = new Date(ms);
  return d.getTime() === d.valueOf() ? 1 : 0;
}

// Truncation toward zero, which is observable: `new Date(1.5)` is 1 and
// `new Date(-1.5)` is -1, not -2.
export function truncatesTowardZero(ms: number): number {
  return new Date(ms + 0.5).getTime() - new Date(ms - 0.5).getTime();
}

// Out of range is NaN rather than a large number. The boundary is 100,000,000
// days either side of the epoch, inclusive.
export function outOfRangeIsNaN(ms: number): number {
  const far = new Date(8.64e15 + ms);
  const t = far.getTime();
  return t === t ? 1 : 0;
}

export function theBoundaryItself(n: number): number {
  const last = new Date(8.64e15).getTime();
  const past = new Date(8.64e15 + 1).getTime();
  return (last === 8.64e15 ? 1 : 0) * 10 + (past === past ? 0 : 1) + n * 0;
}

// A date in a field, which is what `fs.Stats` is: `atime` and the rest are a
// `Date` derived from a number the platform supplies.
class Stat {
  atime: Date;
  mtime: Date;
  constructor(ms: number) {
    this.atime = new Date(ms);
    this.mtime = new Date(ms + 1000);
  }
  gap(): number {
    return this.mtime.getTime() - this.atime.getTime();
  }
  accessed(): number {
    return this.atime.getTime();
  }
}

export function inAField(ms: number): number {
  const s = new Stat(ms);
  return s.gap() + s.accessed();
}

// `toISOString` is **refused**, and by the oracle rather than by the calendar.
// `new Date(NaN).toISOString()` throws a RangeError in node, and a runtime
// helper here has no way to throw — so it would answer with a string where node
// raises, and the differential cannot see that: it scores node's throw as a
// case not reached rather than as a disagreement. A divergence the oracle is
// blind to is the worst outcome available.
//
// `examples/dates-unsupported` holds it, with the `getFullYear` family, which
// is refused for a different reason: those read a *local* calendar, and a
// timezone database would make one program answer differently on two machines.
