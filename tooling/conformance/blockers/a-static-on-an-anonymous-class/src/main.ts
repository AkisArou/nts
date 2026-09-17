// expect: NTS1001 a static field of an anonymous class
//
// A `static` on a class expression with no name of its own.
//
// Everything else about an anonymous class expression lowers as of 2026-09-17 --
// fields, methods, accessors, a constructor, `extends`, `implements` -- because
// its members are named for the layout's stand-in, `Type8#which`, which is
// unique by construction and which nothing outside the program has to read.
//
// **A `static` is the one member that cannot take that name**, and the reason is
// not a missing case. A static is addressed by name *from source*: the program
// writes `C.s`, and `C` is the variable the expression was assigned to rather
// than anything the class knows about itself. Two anonymous classes assigned to
// two variables would need two storages named from a side neither of them has,
// and `Type8__s` as a stand-in is a global no source can be traced back to.
//
// Giving the class a name answers it, which is what the corpus already does --
// `const Shape = class Inner extends Error { … }`, see `blockers/class-expression`
// -- so this is a refusal with a one-token workaround rather than a wall.
//
// It refuses at the read, `C.s`, and not at the declaration: the storage is what
// is missing, so the site that wanted it is the site that says so.

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
