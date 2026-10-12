// The boundary benchmark's program: one export per boundary shape, plus a
// loop that calls a host import, so both directions are measured on code the
// compiler emits.
export function add(a: number, b: number): number {
  return a + b;
}
export function both(a: boolean, b: boolean): boolean {
  return a && b;
}
export function join(a: string, b: string): string {
  return a + b;
}
export function nothing(): void {}
export function sines(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) total += Math.sin(i);
  return total;
}
