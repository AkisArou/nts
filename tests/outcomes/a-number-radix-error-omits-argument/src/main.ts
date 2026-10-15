// run: check
// Node v24.20.0 says "radix argument must be"; the numeric radix guard
// currently omits "argument". Only the radix differs in the control.
export function badRadix(n: number): string {
  try { return (15).toString((n & 1) === 0 ? 0 : 1); }
  catch (error) { return (error as Error).name + ": " + (error as Error).message; }
}
export function validRadix(n: number): string {
  try { return (15).toString(2); }
  catch (error) { return (error as Error).name + ": " + (error as Error).message; }
}
