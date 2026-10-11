interface Sink { take(x: number): number }
interface Wide { take(x: number | string): number }
function same(s: Sink, n: number): number { return s.take === s.take ? s.take(n) : -1; }
export function result(n: number): number {
  const w: Wide = { take(x: number | string): number { return n; } };
  return same(w, n);
}

// Keep the direct face's field reader alongside the wider source-copy path.
export function ownFace(n: number): number {
  const own: Sink = { take(x: number): number { return n + x; } };
  return same(own, n);
}
