interface Sink { take(x: number): number }
interface Wide { take(x: number | string): number }
function same(s: Sink): boolean { const method = s.take; return method === s.take; }
function forward(s: Sink): boolean { const alias = s; return same(alias); }
export function result(n: number): boolean {
  const w: Wide = { take(x: number | string): number { return n; } };
  return forward(w);
}

// Materialise Sink's own closure field as a control for the uncopied helper.
// The wider caller above still needs its concrete source copies.
export function ownFace(n: number): boolean {
  const own: Sink = { take(x: number): number { return n + x; } };
  return same(own);
}
