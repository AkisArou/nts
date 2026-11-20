// Control: bypass the outer generic call.
class Box {
  m(): number { return 1; }
}
class Other {
  readonly n: number;
  constructor(n: number) { this.n = n; }
  m(): number { return this.n * 10; }
}
function call<T extends Box>(r: T): number { return r.m(); }
function outer<U extends Box>(u: U): number { return call(u); }
export function probe(n: number): number { return call(new Other(n & 7)); }
