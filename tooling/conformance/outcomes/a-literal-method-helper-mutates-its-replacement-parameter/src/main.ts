// run: check
interface Sink { take(x: number): number }
interface Wide { take(x: number | string): number }
function use(s: Sink, n: number): number { return s.take(n); }
function change(w: Wide, replacement: Wide['take']): void { replacement = (x: 3): number => x + 7; w.take = replacement; }
export function result(n: number): number {
  const w: Wide = { take(x: number | string): number { return n; } };
  change(w, (x: number | string): number => n + 5);
  return use(w, n);
}
