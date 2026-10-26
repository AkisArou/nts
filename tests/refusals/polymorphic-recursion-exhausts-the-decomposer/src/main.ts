// expect: NTS1001 a property `value` of unrepresentable type (`Nest`) is not supported by this lowering yet

// A class whose method returns a deeper nesting of itself:
//
//     class Nest<T> { deeper(): Nest<Nest<T>> { … } }
//
// `Nest<number>` has a `deeper` returning `Nest<Nest<number>>`, whose
// `deeper` returns `Nest<Nest<Nest<number>>>`, without end. Every step is a
// genuinely new *concrete* type -- no parameter involved -- so the checker
// makes each one as the decomposer asks for its members, and the walk runs
// until the budget stops it. **Where the budget stops is arbitrary**: it
// landed on `Nest`'s own form here and, in the probe harness this was found
// with, on `Test262Error`, whose members were lost to a class three files
// away. Measured 2026-09-22 on the binary before generic instantiation
// landed as well: 8,215 types decomposed for a ten-line program.
//
// This is the library explosion `PromiseLike<T>` has, in a program's own
// class, and the decomposer's guard on *forms* does not see it because the
// chain is concrete. What it wants is a bound on the nesting of concrete
// arguments, so the chain stops at a depth rather than at a budget and the
// cutoff names this class rather than whichever came next. A first attempt
// at one -- counting how many instantiations a type argument nests -- was
// written, asked only of generic *forms*, and removed on 2026-09-22 when
// the forms pass stopped needing it: a form is recognised by its arguments
// being bare type parameters, which is a cheaper question and the right one
// for that pass. The bound this fixture wants is a different one, over
// concrete arguments, and nothing asks it yet.

// Expectation provenance: the sealed 38c0aec9d9d11354 capture (2026-10-25)
// still stops at the unchanged native type budget of 4096 and refuses the
// program. Its cutoff is reported while laying out `value`, not while looking
// up a class member. This renews the exact diagnostic only: it does not add the
// concrete nesting bound described below or treat partial capture as success.
// Historical expectation: NTS1001 a member of `Nest`, a class this compiler has no type for

class Nest<T> {
  value: T;

  constructor(value: T) {
    this.value = value;
  }

  deeper(): Nest<Nest<T>> {
    return new Nest<Nest<T>>(this);
  }
}

export function twoDeep(n: number): number {
  return new Nest<number>(n).deeper().value.value + 1;
}
