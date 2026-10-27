// expect: a property `storage` of unrepresentable type (a union of an array | null)
// Reduced from AWFY DeltaBlue's Vector.with. The free-function control has
// the same generic factory body, and the direct control allocates the same
// concrete class. The generic static method refuses while both controls lower.
class Vector<E> {
  storage: E[] | null;

  constructor() { this.storage = []; }

  static with<E>(elem: E): Vector<E> {
    const vector = new Vector<E>();
    vector.storage!.push(elem);
    return vector;
  }

  at(index: number): E { return this.storage![index]; }
}

export function throughStatic(n: number): number {
  return Vector.with<number>(n).at(0);
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
