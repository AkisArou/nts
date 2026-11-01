// run: check
// Node v24.20.0 says "Invalid count value: -1"; the count guard currently
// omits the count. Only the count differs in the control.
export function badCount(n: number): string {
  try { return "x".repeat((n & 1) === 0 ? -1 : -2); }
  catch (error) { return (error as Error).name + ": " + (error as Error).message; }
}
export function validCount(n: number): string {
  try { return "x".repeat(2); }
  catch (error) { return (error as Error).name + ": " + (error as Error).message; }
}
