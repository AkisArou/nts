// Typechecks fine, and a copy cannot be made for it. Every export here must be
// REFUSED: a generic class is lowered once per *instantiation*, so the shapes
// that have no instantiation to copy from have nothing to lower.
//
// When one of them lands, move it into `examples/generic-classes` rather than
// deleting it -- the fixture starting to compile is what the test is for.

// A generic class extending a generic one **at its own type parameter**. The
// base is `Container<T>`, which is the declaration rather than an
// instantiation, and the declaration has no layout: `u: U` has no width. The
// copy for `Boxed<number>` would need `Container<number>` as its base, and
// nothing in the program names that type.
class Container<U> {
  constructor(public u: U) {}
  peek(): U {
    return this.u;
  }
}

class Boxed<T> extends Container<T> {
  constructor(v: T) {
    super(v);
  }
  read(): T {
    return this.peek();
  }
}

export function genericBase(seed: number): number {
  return new Boxed<number>(seed).read();
}

// A generic **method** on a generic class. `map` has a type parameter of its
// own, so one copy of the class is not one copy of the method: `U` is decided
// per call site, and the class copy is decided per `new`.
class Cell<T> {
  constructor(public v: T) {}
  map<U>(f: (t: T) => U): U {
    return f(this.v);
  }
}

export function genericMethod(seed: number): number {
  return new Cell<number>(seed).map<number>((n) => n * 2);
}

// A generic class constructing **itself at its own type parameters**. Inside
// the copy for `Entry<number, string>` the substitution says `Entry<V, K>` is
// `Entry<string, number>`, and no such type exists in the program: the checker
// instantiates a class where the source names one, and the source here names it
// only generically.
class Entry<K, V> {
  constructor(
    public key: K,
    public value: V,
  ) {}
  swapped(): Entry<V, K> {
    return new Entry<V, K>(this.value, this.key);
  }
}

export function selfInstantiating(seed: number): number {
  return new Entry<number, string>(seed, "qq").swapped().value;
}
