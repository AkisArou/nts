// A program's own class named `Uint8Array` is that class to `new` and to
// `instanceof`. Both were chosen by the name: `new` built the runtime's typed
// array and skipped the constructor, and `instanceof` then asked the runtime's
// question of it, so the two answered consistently and wrongly.
// The control names the same class `Bytes`.
let built = 0;
class Uint8Array {
  constructor(readonly length: number) {
    built += 1;
  }
}
export function own(n: number): number {
  built = 0;
  const made = new Uint8Array((n & 7) + 1);
  return (made instanceof Uint8Array ? 100 : 0) + made.length * 10 + built;
}
export function other(n: number): number {
  const value: object = [n];
  return value instanceof Uint8Array ? 1 : 0;
}
