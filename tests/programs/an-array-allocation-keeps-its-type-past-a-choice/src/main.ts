// `new Array(size)` has the library overload's any[] type. A choice that
// passes it into E[] | null must use that destination's element type, just
// as the if/else control does. The generic has two live instantiations.
class Vector<E> {
  storage: E[] | null;
  count = 0;
  constructor(size: number) {
    this.storage = size === 0 ? null : new Array(size);
  }
  append(item: E): void {
    if (this.storage === null) this.storage = new Array(4);
    this.storage[this.count] = item;
    this.count++;
  }
  first(): E { return this.storage![0]; }
}

class IfVector<E> {
  storage: E[] | null;
  count = 0;
  constructor(size: number) {
    if (size === 0) this.storage = null;
    else this.storage = new Array(size);
  }
  append(item: E): void {
    if (this.storage === null) this.storage = new Array(4);
    this.storage[this.count] = item;
    this.count++;
  }
  first(): E { return this.storage![0]; }
}

export function conditional(n: number): number {
  const v = new Vector<number>(n & 3);
  v.append(n);
  return v.first() + v.count;
}

export function ifElseControl(n: number): number {
  const v = new IfVector<number>(n & 3);
  v.append(n);
  return v.first() + v.count;
}

export function strings(n: number): string {
  const v = new Vector<string>(n & 3);
  v.append("value:" + n);
  return v.first();
}

export function stringsControl(n: number): string {
  const v = new IfVector<string>(n & 3);
  v.append("value:" + n);
  return v.first();
}

export function parenthesized(n: number): number {
  const size = (n & 3) + 1;
  const xs: number[] = ((new Array(size)));
  for (let i = 0; i < size; i++) xs[i] = n + i;
  return xs[size - 1];
}

export function nested(n: number): number {
  const size = (n & 3) + 1;
  const xs: number[] = n < 0 ? (new Array(size)) : n > 0 ? new Array(size) : new Array(size);
  for (let i = 0; i < size; i++) xs[i] = n + i;
  return xs[size - 1];
}

export function nullish(n: number): number {
  const size = (n & 3) + 1;
  const prior: number[] | null = n < 0 ? [n] : null;
  const xs: number[] = prior ?? new Array(size);
  xs[0] = n + size;
  return xs[0];
}

export function disjunction(n: number): number {
  const size = (n & 3) + 1;
  const prior: number[] | null = n < 0 ? [n] : null;
  const xs: number[] = prior || new Array(size);
  xs[0] = n + size;
  return xs[0];
}

export function conjunction(n: number): number {
  const size = (n & 3) + 1;
  const prior: number[] | null = n < 0 ? null : [n];
  const xs: number[] | null = prior && new Array(size);
  if (xs === null) return -1;
  xs[0] = n + size;
  return xs[0];
}

console.log(conditional(0), conditional(3), ifElseControl(3), strings(2), stringsControl(2));
console.log(parenthesized(2), nested(2), nullish(2), disjunction(2), conjunction(2));
