// Control: the same class as its subject, named `Bytes`.
let built = 0;
class Bytes {
  constructor(readonly length: number) {
    built += 1;
  }
}
export function own(n: number): number {
  built = 0;
  const made = new Bytes((n & 7) + 1);
  return (made instanceof Bytes ? 100 : 0) + made.length * 10 + built;
}
export function other(n: number): number {
  const value: object = [n];
  return value instanceof Bytes ? 1 : 0;
}
