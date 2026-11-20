// Control: invoke each mapped/Record field directly instead of forwarding it.
class Box {
  m(): number { return 1; }
}
type Mapped = { [K in "m"]: () => number };
function call<T extends Box>(r: T): number { return r.m(); }
function attempt(run: () => number): number {
  try { return run(); } catch { return -1; }
}
export function probe(n: number): number {
  const r: Mapped = { m: () => n * 10 };
  return r.m();
}
export function viaRecord(n: number): number {
  const r: Record<"m", () => number> = { m: () => n * 2 };
  return r.m();
}
export function mappedThrows(n: number): number {
  const k = n & 7;
  const r: Mapped = { m: () => {
    if (k > 2) { throw new RangeError("mapped"); }
    return k * 10;
  } };
  return attempt(() => r.m());
}
export function recordThrows(n: number): number {
  const k = n & 7;
  const r: Record<"m", () => number> = { m: () => {
    if (k > 2) { throw new RangeError("record"); }
    return k * 10;
  } };
  return attempt(() => r.m());
}
