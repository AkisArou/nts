// Numbers erased from 32-bit integers and read back through `unknown`, against
// node. A masked value fits i31 by its definition and erases without a test;
// a signed or unsigned 32-bit value is tested, and boxes where it does not fit.
function widen(value: unknown): unknown {
  return value;
}
function back(value: unknown): number {
  return typeof value === 'number' ? value : NaN;
}
export function masked(x: number): number {
  return back(widen(x & 1023));
}
export function signed(x: number): number {
  return back(widen(x | 0));
}
export function unsigned(x: number): number {
  return back(widen(x >>> 0));
}
// Equal numbers erased from an integer and from a double are one value.
export function sameAsDouble(x: number): boolean {
  return widen(x | 0) === widen((x | 0) + 0.5 - 0.5);
}
