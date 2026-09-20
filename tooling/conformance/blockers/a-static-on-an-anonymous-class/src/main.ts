// expect: nothing refused -- FIXED, kept as a guard
//
// A `static` on a class expression with no name of its own. It refused until
// 2026-09-20, and the refusal's reasoning is kept below because the reasoning
// is what was wrong -- not a missing case.
//
// It said: everything else about an anonymous class lowers, because its members
// are named for the layout's stand-in, `Type8#which`; but a `static` "is
// addressed by name *from source*", the program writes `C.s` where `C` is the
// variable rather than anything the class knows about itself, so "two anonymous
// classes assigned to two variables would need two storages named from a side
// neither of them has, and `Type8__s` as a stand-in is a global no source can be
// traced back to".
//
// **Both halves are false, and each was measured rather than re-argued.**
//
// The name reaches exactly one place: the label on a `Global`. `C.s` resolves by
// *symbol* -- `scope.variables.insert(symbol.0, global)` -- so the spelling
// decides nothing, and `unshared_name` already disambiguates collisions. Two
// anonymous classes do not collide either, because `instance_type_of` gives each
// class expression its own `TypeId`: the sibling example emits `Type22___read`
// and `Type23___read` from two classes that both declare `static v`.
//
// And "a global no source can be traced back to" had the reader backwards. The
// stand-in is what makes it traceable: the dump carries `Type19___v` beside
// `Type19___bump`, so the field sits with its own class's methods. The refusal
// spelled it `Type8__s` -- a name the compiler never produces -- which is a fair
// sign the objection was to an imagined string rather than to an emitted one.
//
// What the refusal cost: 7 test262 files, all `static #$` and friends inside a
// `var C = class { ... }`, plus the one-token workaround it recommended.
//
// This fixture constant-folds its static, so the *name* is exercised by
// `examples/two-anonymous-classes-with-one-static-name` and not here. What it
// guards is that the construct lowers at all.

const C = class {
  static s = 5;

  v: number;

  constructor(v: number) {
    this.v = v;
  }
};

export function total(n: number): number {
  return C.s + new C(n).v;
}
