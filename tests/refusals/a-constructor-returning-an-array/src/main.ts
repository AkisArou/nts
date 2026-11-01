// expect: NTS1001 a constructor returning an object, which replaces the instance `new` would have answered is not supported by this lowering yet
// ARES-6 ML: Matrix's one-numeric-argument constructor returns a plain Array.
// JavaScript uses an explicitly returned object as the result of new.
// The control replaces construction with a factory returning the same Array.
class ReturningArray {
  constructor(n: number) {
    return [n, n + 1];
  }
}
// TypeScript describes new ReturningArray as ReturningArray despite its explicit
// object return. This facade states the actual result of every construction.
const MakeArray = ReturningArray as unknown as new (n: number) => number[];
export function work(n: number): number {
  const values = new MakeArray(n);
  return values[0] * 3 + values[1] + values.length;
}
