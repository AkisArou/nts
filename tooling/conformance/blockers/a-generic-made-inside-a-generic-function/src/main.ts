// expect: NTS1001 a generic function no call pins down (the type parameter `T`)

// A generic class made inside a generic **function**, where the function's own
// argument comes from an enclosing generic class rather than from a concrete
// call.
//
// `hir::instantiate` materialises `Inner<number>` for `ViaClass<number>` --
// the control below lowers -- because a class's instantiations are records the
// checker made, and each is a sigma to substitute. A generic function's copies
// come from `generics::function_instantiations`, which reads the *call sites*:
// `make<T>(this.v)` inside `ViaClass<T>` passes the class's parameter, so no
// call pins `make` down and it has no copies, so the materialiser has no sigma
// for `Owner::Function(make)` and never makes the `Inner<number>` that
// `make`'s body needs.
//
// **This is what is left of the census row that generic instantiation was
// built for.** Of the 99 sites of `a member of X, a class this compiler has
// no type for` in `runtime/node`, 82 remain on 2026-09-22 and every one of
// them is this shape: `PipeState<T>` is made inside `startPipe<T>`,
// `TeeState<T>` and `ByteTeeState<T>` inside `tee<T>`,
// `ReadableStreamAsyncIterator<T>` inside `getIterator<T>` -- each a generic
// function called from a `ReadableStream<T>` method with the class's own
// parameter.
//
// Closing it means a copy of a generic function per *enclosing* generic copy,
// not only per concrete call: inside `ViaClass<number>`'s body, `make<T>` is
// `make<number>`, and that copy's sigma is then one more owner for the
// materialiser to walk. `Structural` already gives a copy of a callee per
// re-typed argument, and this is the same rule for a type argument.

class Inner<T> {
  v: T;

  constructor(v: T) {
    this.v = v;
  }

  get(): T {
    return this.v;
  }
}

function make<T>(v: T): Inner<T> {
  return new Inner<T>(v);
}

class ViaFunction<T> {
  v: T;

  constructor(v: T) {
    this.v = v;
  }

  build(): T {
    return make<T>(this.v).get();
  }
}

export function throughAFunction(n: number): number {
  return new ViaFunction<number>(n).build() + 1;
}

/** Control: the same class made directly, which lowers. */
class ViaClass<T> {
  v: T;

  constructor(v: T) {
    this.v = v;
  }

  build(): T {
    return new Inner<T>(this.v).get();
  }
}

export function throughAClass(n: number): number {
  return new ViaClass<number>(n).build() + 2;
}
