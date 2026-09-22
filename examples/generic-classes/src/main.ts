// A generic class is lowered once per instantiation and not at all as itself:
// a field of type `T` has no width, and `Box<number>` and `Box<string>` are two
// classes that happen to share a source.
//
// The machinery for that -- a copy per instantiation, a substitution, a name
// carrying the type id -- was written for generic *functions* and always
// accepted a class. What it could not do was find the class's type parameters.
// The frontend leaves the declaration's own type as an undecomposed placeholder,
// because `v: T` has no representation, and the search for "the type whose
// arguments are its own parameters" only looked at types that *had* been
// decomposed. So the declaration was never in the group, no declaration was
// found, and every instantiation was dropped along with it.

class Box<T> {
  v: T;
  constructor(v: T) {
    this.v = v;
  }
  get(): T {
    return this.v;
  }
  replace(v: T): T {
    const old = this.v;
    this.v = v;
    return old;
  }
}

// Two instantiations of one source, at types of different width. Nothing is
// shared between them but the text.
export function twoCopies(seed: number): number {
  const n = new Box<number>(seed);
  const s = new Box<string>("abcd");
  return n.get() + s.get().length;
}

// The old value comes back out, so a copy that returned the *new* one -- or
// that shared one field between the two instantiations -- disagrees here.
export function replaced(seed: number): number {
  const b = new Box<number>(seed);
  const first = b.replace(seed + 1);
  return first * 1000 + b.get();
}

// A type argument that is itself a class, so the field is a pointer and the
// method returns one.
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

export function classArgument(seed: number): number {
  const b = new Box<Point>(new Point(seed, seed + 1));
  return b.get().x * 100 + b.get().y;
}

// `Box<Box<number>>`: the argument is an instantiation of the same class, which
// is a copy naming a copy.
export function nested(seed: number): number {
  const inner = new Box<number>(seed);
  const outer = new Box<Box<number>>(inner);
  return outer.get().get() * 2;
}

// A constraint. `T extends number` makes `>` legal in the body, and the copy is
// still made from the call site rather than from the constraint.
class Pair<T extends number> {
  constructor(
    public a: T,
    public b: T,
  ) {}
  larger(): T {
    return this.a > this.b ? this.a : this.b;
  }
}

export function constrained(a: number, b: number): number {
  return new Pair<number>(a, b).larger();
}

// A generic class extending a plain one. The checker answers `getBaseTypes` for
// a *declaration*, and `Box<number>` is a reference to one, so an instantiation
// records no base of its own -- which left `tag()` with no declaration in the
// hierarchy until the copy inherited the declaration's.
class Tagged {
  tag(): number {
    return 7;
  }
  // Not overridden below, so reaching it from a copy needs the copy to have a
  // base at all. `Labelled` overriding `tag` would find `tag` on itself and
  // never ask.
  origin(): number {
    return 11;
  }
}

class Labelled<T> extends Tagged {
  constructor(public value: T) {
    super();
  }
  override tag(): number {
    return 9;
  }
}

export function inherited(seed: number): number {
  const l = new Labelled<number>(seed);
  return l.tag() * 100 + l.origin() * 10 + l.value;
}

// The override reached through the *base* type, from two copies. One vtable slot
// is numbered against `Tagged`, and both copies have to fill it.
export function dispatched(seed: number): number {
  const a: Tagged = new Labelled<number>(seed);
  const b: Tagged = new Labelled<string>("z");
  const plain: Tagged = new Tagged();
  return a.tag() + b.tag() + plain.tag();
}

// A class with a concrete argument extends a generic one. This is the shape
// `runtime/node` is full of, and it is not the same shape as the one above:
// here the *base* is the instantiation.
class Container<U> {
  constructor(public u: U) {}
  peek(): U {
    return this.u;
  }
}

class Numbers extends Container<number> {
  constructor(u: number) {
    super(u);
  }
  twice(): number {
    return this.peek() * 2;
  }
}

export function concreteBase(seed: number): number {
  return new Numbers(seed).twice();
}

// A generic class implementing an interface, reached through it.
interface Sized {
  size(): number;
}

class Sack<T> implements Sized {
  constructor(public items: T[]) {}
  size(): number {
    return this.items.length;
  }
}

export function throughInterface(seed: number): number {
  const s: Sized = new Sack<number>([seed, seed + 1, seed + 2]);
  return s.size();
}

// A generic class as an ordinary field of a non-generic one.
class Wallet {
  slot: Box<number>;
  constructor(seed: number) {
    this.slot = new Box<number>(seed);
  }
  read(): number {
    return this.slot.get();
  }
}

export function asAField(seed: number): number {
  return new Wallet(seed).read();
}

// A `static` member has no receiver, and TypeScript forbids one from
// referencing a class type parameter. So it is **one** function however many
// copies the class has -- and the call site agrees, because `Factory.of(n)`
// names no instantiation. Two instantiations below, so a copy that named the
// static for one of them would define it twice.
class Factory<T> {
  constructor(public v: T) {}
  static of(n: number): Factory<number> {
    return new Factory<number>(n);
  }
  unwrap(): T {
    return this.v;
  }
}

export function staticOnGeneric(seed: number): number {
  const words = new Factory<string>("abc");
  return Factory.of(seed).unwrap() + words.unwrap().length;
}

// Which member of the group is the *declaration* is not decided by "the one
// whose arguments are its own type parameters". `widthOf` names `Entry` at
// **its** parameters, before the class is declared, so that type has
// all-parameter arguments too -- and picking it makes the substitution map `A`
// and `B` rather than `K` and `V`, leaving the class's own parameters
// unsubstituted. The class declaration node's type is the authority.
// Never called: its only job is to exist, so that `Entry<B, A>` is interned
// before `Entry<K, V>` is.
function widthOf<A, B>(_entry: Entry<B, A>, fallback: number): number {
  return fallback;
}

// Two type parameters, used in both orders.
class Entry<K, V> {
  constructor(
    public key: K,
    public value: V,
  ) {}
}

export function twoParameters(seed: number): number {
  const e = new Entry<number, string>(seed, "qq");
  return e.key * 10 + e.value.length;
}
