// Run-time refusals name their cause, where all of them used to read
// "internal typed value contract". The first three were refused in Wasm and
// now answer: the lowering reads `splice(n, undefined)`'s count as the method
// does and gives `join` its comma for an absent separator, so the values Wasm
// refused never reach it. `shiftNull` is still refused by name.
export function spliceUndefined(n: number): number {
  const xs = [1, 2, 3];
  return xs.splice(n, undefined).length * 10 + xs.length;
}
export function joinUndefined(n: number): number {
  return [n, n].join(undefined).length;
}
function joined(sep?: string): string {
  return ['a', 'b'].join(sep);
}
export function optionalSeparator(n: number): number {
  return (n > 0 ? joined() : joined('-')).length;
}
class P {
  constructor(readonly x: number) {}
}
export function shiftNull(n: number): number {
  const xs: (P | null)[] = [null, new P(n)];
  const v = xs.shift();
  return v === null ? 1 : v === undefined ? 2 : 3;
}
