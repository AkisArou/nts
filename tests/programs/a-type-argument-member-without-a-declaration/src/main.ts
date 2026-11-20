// Mapped and Record members have storage without a property declaration.
// A generic call uses the same closure entry as its direct-call control (#888).
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
  return call(r);
}
export function viaRecord(n: number): number {
  const r: Record<"m", () => number> = { m: () => n * 2 };
  return call(r);
}
export function mappedThrows(n: number): number {
  const k = n & 7;
  const r: Mapped = { m: () => {
    if (k > 2) { throw new RangeError("mapped"); }
    return k * 10;
  } };
  return attempt(() => call(r));
}
export function recordThrows(n: number): number {
  const k = n & 7;
  const r: Record<"m", () => number> = { m: () => {
    if (k > 2) { throw new RangeError("record"); }
    return k * 10;
  } };
  return attempt(() => call(r));
}
