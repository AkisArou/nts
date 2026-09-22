// A generic class instantiated only from **inside another generic**.
//
//     class Outer<T> { make(): Inner<T> { return new Inner<T>(this.seed); } }
//     new Outer<number>(3).make().get()
//
// A generic class is lowered once per instantiation, and an instantiation was
// a type record the checker had materialised: `Inner<number>` existed if some
// expression had that type. The `new` inside `Outer` has type `Inner<T>` --
// a *template*, whose argument is `Outer`'s parameter -- so unless the program
// spelled `Inner<number>` somewhere else, the checker never made it, `Inner`
// had no copies, and every member of it refused as `a member of `Inner`, a
// class this compiler has no type for`. 99 sites in the census, all five of
// them web-platform stream classes (`PipeState<T>`, `TeeState<T>`, ...) made
// only from inside `ReadableStream<T>`.
//
// # What landed, in two halves
//
// The frontend left a generic *form* -- a type whose arguments are
// parameters -- undecomposed, on the reasoning that "the members of a form
// parameterised by one are members nothing can use". `hir::instantiate` is
// the thing that uses them: for every template `D<args>` whose arguments
// mention an enclosing generic's parameters, and every instantiation of that
// generic, it writes `D<σ(args)>` into the snapshot as the checker would have
// -- the form's members substituted, its bases and index signatures likewise
// -- to a fixpoint, so every pass downstream meets the new records as the
// checker's own. The decomposer now decomposes the program's own forms, in a
// pass of their own after everything concrete, so the budget's cutoff can
// only ever land on a form.
//
// Each copy's `Substitution` then carries, beside what `T` is, the map from
// each template it contains to the instantiation it makes of it, and
// `representation_of` answers the instantiation's id for the template's.
// That is the one place the lowering learns of any of this.
//
// # And what stood behind it
//
// Generic inheritance had never worked, even directly: the checker writes a
// class's base as `Base<T, this>`, the form's, and never makes `Base<number>`,
// so `new Derived<number>()` refused on the binary before this. The
// materialiser settles every instantiation's bases under its own σ, truncated
// to the declaration's arity. And a class's field initialisers run at the
// `new` site, in the caller's builder, where `Link<T> | null = null` read
// `Link<T>` as the form; they run under the instance's substitution now.

class Inner<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }

  get(): T {
    return this.value;
  }
}

class Outer<T> {
  seed: T;

  constructor(seed: T) {
    this.seed = seed;
  }

  /** The corpus shape: a template that escapes as a return type. */
  make(): Inner<T> {
    return new Inner<T>(this.seed);
  }

  /** A template that never escapes: nothing outside names `Inner<T>`. */
  twice(): T {
    const inner = new Inner<T>(this.seed);
    return inner.get();
  }

  /** A template over a composite: `Inner<T[]>`. */
  list(): Inner<T[]> {
    return new Inner<T[]>([this.seed, this.seed]);
  }
}

export function fromAClass(n: number): number {
  return new Outer<number>(n).make().get() + 1;
}

export function notEscaping(n: number): number {
  return new Outer<number>(n).twice() + 1;
}

export function overAComposite(n: number): number {
  return new Outer<number>(n).list().get().length + n;
}

/** Two instantiations of the owner make two of the template. */
export function twoInstantiations(n: number): number {
  const a = new Outer<number>(n);
  const b = new Outer<string>("ab");
  return a.make().get() + b.make().get().length;
}

function wrap<T>(x: T): Inner<T> {
  return new Inner<T>(x);
}

/** The owner is a generic function, whose pinned calls give the σ. */
export function fromAFunction(n: number): number {
  return wrap<number>(n).get() + 1;
}

class Mid<T> {
  inner: Inner<T>;

  constructor(x: T) {
    this.inner = new Inner<T>(x);
  }
}

class Top<T> {
  seed: T;

  constructor(seed: T) {
    this.seed = seed;
  }

  deep(): T {
    return new Mid<T>(this.seed).inner.get();
  }
}

/** Two levels: `Top<number>` implies `Mid<number>`, which implies `Inner<number>`. */
export function twoLevels(n: number): number {
  return new Top<number>(n).deep() + 1;
}

class Link<T> {
  value: T;
  next: Link<T> | null = null;

  constructor(value: T) {
    this.value = value;
  }
}

class List<T> {
  head: Link<T> | null = null;

  push(v: T): void {
    const link = new Link<T>(v);
    link.next = this.head;
    this.head = link;
  }

  sum(f: (v: T) => number): number {
    let total = 0;
    let at = this.head;
    while (at !== null) {
      total += f(at.value);
      at = at.next;
    }
    return total;
  }
}

/** A self-referential template, with a field initialiser typed by it. */
export function selfReferential(n: number): number {
  const list = new List<number>();
  list.push(n);
  list.push(1);
  return list.sum((v: number): number => v);
}

class Base<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }

  get(): T {
    return this.value;
  }
}

class Derived<T> extends Base<T> {
  tag: number;

  constructor(value: T, tag: number) {
    super(value);
    this.tag = tag;
  }

  plus(): T {
    return this.get();
  }
}

/** Generic inheritance, direct: the base `Base<T, this>` settled to `Base<number>`. */
export function inheritsDirectly(n: number): number {
  const d = new Derived<number>(n, 7);
  return d.plus() + d.tag;
}

class Maker<T> {
  seed: T;

  constructor(seed: T) {
    this.seed = seed;
  }

  derived(): Derived<T> {
    return new Derived<T>(this.seed, 1);
  }
}

/** And through a template. */
export function inheritsThroughATemplate(n: number): number {
  return new Maker<number>(n).derived().plus() + 1;
}
