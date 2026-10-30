// Control for a-generic-static-factory-with-a-nullable-array.
// The factory is the free function make instead of a static method,
// with the same generic body and nullable storage.
class Vector<E> {
  storage: E[] | null;

  constructor() { this.storage = []; }

  at(index: number): E { return this.storage![index]; }
}

export function throughStatic(n: number): number {
  return make<number>(n).at(0);
}

function make<E>(elem: E): Vector<E> {
  const vector = new Vector<E>();
  vector.storage!.push(elem);
  return vector;
}

export function freeFunctionControl(n: number): number {
  return make<number>(n).at(0);
}

export function directControl(n: number): number {
  const vector = new Vector<number>();
  vector.storage!.push(n);
  return vector.at(0);
}
