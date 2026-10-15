// run: check
//
// Node bounds ToIntegerOrInfinity(digits), so -0.9 and 100.9 select zero
// and 100 digits. The subject changes only those digit arguments from its
// integer control; neither value should take the RangeError path.
export function fractional(n: number): string {
  const digits = (n & 1) === 0 ? -0.9 : 100.9;
  try { return (1.25).toFixed(digits); }
  catch (error) { return (error as Error).name; }
}

export function integerControl(n: number): string {
  const digits = (n & 1) === 0 ? 0 : 100;
  try { return (1.25).toFixed(digits); }
  catch (error) { return (error as Error).name; }
}
