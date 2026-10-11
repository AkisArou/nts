interface Sink { take(x: number): number }
interface Wide { take(x: number | string): number }
function same(s: Sink): boolean { const method = s.take; return method === s.take; }
function forward(s: Sink): boolean { const alias = s; return same(alias); }
export function result(n: number): boolean {
  const w: Wide = { take(x: number | string): number { return n; } };
  return forward(w);
}
