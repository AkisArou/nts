// The string member and the iterable protocol have separate keys.
class Both {
  constructor(readonly n: number) {}
  iterator(): number { return this.n + 1; }
  *[Symbol.iterator](): Generator<number> { yield this.n + 2; }
}
export function stringMember(n: number): number { return new Both(n).iterator(); }
export function symbolMember(n: number): number {
  let out = 0;
  for (const value of new Both(n)) out += value;
  return out;
}
export function bothMembers(n: number): number {
  const value = new Both(n);
  let out = value.iterator() * 10;
  for (const item of value) out += item;
  return out;
}
