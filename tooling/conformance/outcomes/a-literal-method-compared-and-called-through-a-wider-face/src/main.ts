// run: check
// Mixed method-value and invocation flow stays on the legacy source-copy path
// until an interface accessor can return the original closure. Main trusts
// this literal's bivariantly narrowed input and answers 27 cases incorrectly.
interface Sink { take(x: number): number }
interface Wide { take(x: number | string): number }
function same(s: Sink, n: number): number { return s.take === s.take ? s.take(n) : -1; }
export function result(n: number): number {
  const w: Wide = { take(x: 3): number { return n + x + 7; } };
  return same(w, n);
}
