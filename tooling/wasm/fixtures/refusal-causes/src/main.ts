// Run-time refusals name their cause. Each of these is refused in Wasm today,
// and each message says why, where all of them used to read "internal typed
// value contract".
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
