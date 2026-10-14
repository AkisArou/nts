// Dates: a struct holding a time value, nothing else (see `dates.rs`).
// `new Date(ms)` clips the value; `getTime` and `valueOf` read it. A date is an
// object, so it compares by identity, erases as itself and keys a Map by its
// identity hash. Its text needs a local calendar, which the lowering refuses.

// `TimeClip` over the whole pool: NaN and the infinities, fractions either
// side of zero, and values past 100,000,000 days.
export function clipped(ms: number): number {
  return new Date(ms).getTime();
}

// `-0` becomes `+0`, which only a division shows.
export function negativeZero(ms: number): number {
  return 1 / new Date(ms > 0 ? -0.5 : -0).getTime();
}

export function valueOfIsGetTime(ms: number): number {
  const d = new Date(ms);
  const t = d.getTime();
  const v = d.valueOf();
  return t === v || (t !== t && v !== v) ? 1 : 0;
}

export function identity(ms: number): number {
  const a = new Date(ms);
  const b = a;
  const c = new Date(ms);
  return (a === b ? 1 : 0) + (a === c ? 10 : 0);
}

// Erased, a date is an object, and the same object.
export function erased(ms: number): string {
  const d = new Date(ms);
  const u: unknown = d;
  return `${typeof u}|${u === d}`;
}

export function inAnArray(ms: number): number {
  const ds = [new Date(ms), new Date(ms + 1)];
  ds.push(new Date(ms + 2));
  return ds[2].getTime() - ds[0].getTime() + ds.length * 1000;
}

// Two dates with one time value are two keys.
export function asMapKeys(ms: number): number {
  const m = new Map<Date, number>();
  const d = new Date(ms);
  m.set(d, 1);
  m.set(new Date(ms), 2);
  m.set(d, 3);
  return m.size * 10 + (m.get(d) ?? 0);
}

function maybe(ms: number): Date | null {
  return ms > 0 ? new Date(ms) : null;
}

export function nullable(ms: number): number {
  const d = maybe(ms);
  return d === null ? -1 : d.getTime();
}

export function captured(ms: number): number {
  const d = new Date(ms);
  const read = (): number => d.getTime();
  return read() + read();
}

class Stamp {
  readonly at: Date;
  constructor(ms: number) {
    this.at = new Date(ms);
  }
}

export function inAField(ms: number): number {
  const stamps = [new Stamp(ms), new Stamp(ms * 2)];
  return stamps[1].at.getTime() - stamps[0].at.getTime();
}
