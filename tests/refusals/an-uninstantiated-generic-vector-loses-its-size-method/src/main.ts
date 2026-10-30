// expect: a method `size` with no declaration in the hierarchy
// AWFY CD/Havlak companion. Only Items<E> changes from Vector<E> to Vector<number>.
class Vector<E> {
  storage: E[] | null;
  constructor() { this.storage = []; }
  size(): number { return this.storage === null ? 0 : this.storage.length; }
}
type Items<E> = Vector<E>;
export class Set<E> {
  items: Items<E>;
  constructor() { this.items = new Vector(); }
  size(): number { return this.items.size(); }
}
export function work(n: number): number { return n; }
