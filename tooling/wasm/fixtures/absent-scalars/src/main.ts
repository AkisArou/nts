// An optional chain whose absent arm puts undefined in a numeric slot.
//
// Where the core proves the chained field present, it folds the `??` away
// and keeps the null test, so the absent arm -- `const undefined : f64` -- is
// emitted on a path no run takes. Wasm gives that slot what JavaScript
// converts undefined to (NaN, 0, false); these cases are the shapes that put
// one there, and both the assigned and the unassigned reads.

class Inner {
  constructor(public v: number) {}
}

class Slot {
  ref?: Inner;
  label?: string;
  count?: number;
  constructor(public given: number) {}
}

export function assigned(n: number): number {
  const s = new Slot(n);
  s.ref = new Inner(n * 2);
  s.label = "xy";
  return (s.ref?.v ?? -6) + (s.label?.length ?? -8) + s.given;
}

export function unassigned(n: number): number {
  const s = new Slot(n);
  return (s.ref?.v ?? -1) + (s.label?.length ?? -3) + (s.count ?? -7) + s.given;
}

export function onOnePath(n: number): number {
  const s = new Slot(n);
  if (n > 0) s.ref = new Inner(n);
  return (s.ref?.v ?? -2) + s.given;
}
