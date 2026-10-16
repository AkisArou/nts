// A callback reached through String(array[i]) must propagate its throw to the
// caller for both erased and typed elements. The explicit method is the control.
class Printer {
  n: number;
  constructor(n: number) { this.n = n; }
  toString(): string { if (this.n < 0) throw 22; return "text"; }
}
function erasedLoop(n: number): number {
  const values: any[] = [new Printer(n)];
  let total = 0;
  for (let i = 0; i < 4; i++) total += String(values[i & 0]).length;
  return total;
}
function typedLoop(n: number): number {
  const values: Printer[] = [new Printer(n)];
  let total = 0;
  for (let i = 0; i < 4; i++) total += String(values[i & 0]).length;
  return total;
}
export function erasedElement(n: number): number {
  try { return erasedLoop(n); } catch (caught) { return caught === 22 ? 22 : -1; }
}
export function typedElement(n: number): number {
  try { return typedLoop(n); } catch (caught) { return caught === 22 ? 22 : -1; }
}
function directLoop(n: number): number {
  const values: Printer[] = [new Printer(n)];
  let total = 0;
  for (let i = 0; i < 4; i++) total += values[i & 0].toString().length;
  return total;
}
export function directControl(n: number): number {
  try { return directLoop(n); } catch (caught) { return caught === 22 ? 22 : -1; }
}
