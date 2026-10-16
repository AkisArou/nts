// The only difference in each pair is the array element's type. A callback
// reached through String(anyArray[i]) must propagate its throw to the caller.
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
export function typedControl(n: number): number {
  try { return typedLoop(n); } catch (caught) { return caught === 22 ? 22 : -1; }
}
