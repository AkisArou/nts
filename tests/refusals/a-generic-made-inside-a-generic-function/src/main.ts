// expect: nothing refused -- FIXED, kept as a guard
//
// **FIXED 2026-09-22, and kept as a guard.** Both arms lower and agree with
// node on all 58 cases. The record of the defect follows unchanged, because
// the shape is worth keeping and this guard is what stops it coming back.
//
// A call written inside a generic body pins its callee's `T` to the enclosing
// `W`, which is not a type anything can be compiled for -- so the call
// counted as pinning nothing and the callee was refused. `unify` records that
// binding now instead of dropping it, and `function_instantiations` makes one
// copy of the callee per instantiation of whatever declares `W`:
// `Templates::bindings_of` says what `W` is in each, and `at_call_in` says
// which copy the call names inside which copy of the class.
//
// Two more things had to move with it. `unify` descends through an
// instantiation's **arguments** -- a parameter `stream: WritableStream<T>`
// against an argument `WritableStream<W>` pins `T` to `W`, and the descent
// had arms for an array and a signature and none for this. And a closure
// written in a generic class body is lowered under that copy's substitution,
// or it reads a capture at the declaration's type while the copy stored the
// instantiation's.

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
