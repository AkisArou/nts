// expect: emit-c --napi -> calls exports.derivedInitialiser(2) === 16
// control: typeof exports.derivedInitialiser === "function"
//
// **FIXED on 2026-09-12, and kept as a guard.** It filed this:
//
//     a derived class's field initialisers run after `super()` returns in
//     JavaScript, so `y = this.x + 10` reads the `x` the base constructor
//     wrote. They were emitted at the `new` *site*, before the constructor was
//     called at all, so the read happened first and found a field nobody had
//     written -- 28 of 29 cases against node, answering `nan`.
//
// `derivedInitialiser(2)` is `2 * 3 + 10` = 16, and it is 16 here now. A
// class's own initialisers are emitted inside its own constructor: at the top
// when it has no base, and immediately after `super()` when it has one.
//
// The guard runs **through the napi boundary**, which is not incidental -- see
// the last section. A `new` inside the program would exercise the ordering
// without exercising the wrapper.
//
// # The expectation was `!== 16` while it reproduced
//
// Because what the broken version read was not defined. With a `number` field
// the slot was read as a double and the answer was `nan`; with an `int32_t`
// field it was an integer's worth of whatever was there. Asserting the specific
// wrong answer would have made the fixture depend on the garbage rather than on
// the ordering.
//
// # The optimiser hid it, and that is the part worth keeping
//
// The first version of this probe used a constant base value -- `this.x = 1`,
// `y = this.x + 10` -- and **agreed with node on all 29 cases**. The first
// explanation offered for that was stack reuse, and it was wrong: dirtying the
// stack before the call changed nothing. The same emitted C at two
// optimisation levels is what answered it, node saying 11 throughout:
//
//     -O0   first call after a dirty stack   10          x read as 0
//           second call                      7.9e+08     x read as garbage
//     -O2   both calls                       11          "correct"
//
// Reading an uninitialised member is undefined behaviour, so at -O2 clang is
// free to produce anything -- including the answer the program would have had
// if it were right. **A release build agreed with node because the optimiser
// chose to, not because the program computed it.**
//
// Two things follow. A probe whose expected answer is a constant cannot tell
// "computed correctly" from "undefined behaviour that landed well"; making the
// base's value depend on the argument is what made it fail, and with a `number`
// field the same -O2 build then answered `nan` on 28 of 29 cases. And a defect
// whose symptom is UB can be invisible in the configuration everything is
// measured in.
//
// # One placement, three defects
//
// Field initialisers being emitted at the `new` site rather than in the
// constructor is also why:
//
//   - a class constructed **only** through the napi boundary never runs them at
//     all -- the wrapper calls `nts_construct_X()` and then the constructor,
//     and there is no `new` site anywhere;
//   - an optional property's presence mask, which is set in the same place, has
//     the same boundary.
//
// Both were fixed by the same move, and neither needed a separate function: the
// wrapper already calls the compiled constructor, so putting a class's
// initialisers *in* its constructor is what makes the wrapper run them. What
// the allocation site keeps is only the classes below the one whose constructor
// it calls -- those declare none of their own, and an implicit constructor is
// `super(...args)` followed by this class's initialisers, so they go after the
// call.
//
// **A class published to JS and constructed nowhere else is still the only way
// to see the second one**, which is why this fixture is `--napi` rather than a
// plain `new`.

class Base {
  x: number;

  constructor(n: number) {
    this.x = n * 3;
  }
}

class Derived extends Base {
  y: number = this.x + 10;

  constructor(n: number) {
    super(n);
  }
}

export function derivedInitialiser(n: number): number {
  return new Derived(n).y;
}
