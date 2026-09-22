// expect: NTS1001 a captured variable of unrepresentable type (the type parameter `T`)

// An object literal built at a generic interface **from inside another
// generic**:
//
//     interface Box<T> { get(): T }
//     class Holder<T> { box(): Box<T> { const s = this.seed; return { get(): T { return s; } }; } }
//
// `hir::instantiate` makes `Box<number>` for `Holder<number>`'s copy, and the
// copy's `representation_of` reads the template `Box<T>` as it. Two things
// in the literal's path do not run under the copy's substitution:
//
//   * the literal's method captures `s`, typed `T`, and the closure's field
//     is typed by `captured_as` from the checker's type -- `T`, which has no
//     representation outside a copy. That is the refusal above.
//   * behind it, the method is laid out as storage by
//     `collect_stored_members`, which runs on a probe with no substitution:
//     `literal_member_owner` answers the *template's* id, so `get` is forced
//     on `Box<T>` and never on `Box<number>`, and the copy's literal finds
//     neither a slot nor a table entry for it.
//
// Closing it means a closure variant per copy for captures typed by `T` --
// the shape `closure_variants` already gives structural copies -- and the
// stored-members pass resolving a template-typed literal to every
// instantiation the enclosing generic makes of it, through
// `instantiate::Templates::instances` under each of the owner's sigmas. The
// control below, the same literal at a concrete `Box<number>`, lowers.

interface Box<T> {
  get(): T;
}

class Holder<T> {
  seed: T;

  constructor(seed: T) {
    this.seed = seed;
  }

  box(): Box<T> {
    const s = this.seed;
    return {
      get(): T {
        return s;
      },
    };
  }
}

export function throughATemplate(n: number): number {
  return new Holder<number>(n).box().get() + 1;
}

/** Control: the same literal at a concrete instantiation. */
export function atAnInstantiation(n: number): number {
  const s = n * 2;
  const box: Box<number> = {
    get(): number {
      return s;
    },
  };
  return box.get() + 1;
}
