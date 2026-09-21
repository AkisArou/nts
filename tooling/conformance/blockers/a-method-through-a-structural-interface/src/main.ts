// expect: NTS1003 `take` cannot be compiled because it calls `S#go`
//
// **One word is the whole difference**, and it is the word TypeScript does not
// require:
//
// ```text
// class C { go(): number { return 3; } }              take(new C())  REFUSED
// class C implements S { go(): number { return 3; } } take(new C())  lowers
// ```
//
// TypeScript is structurally typed: a class satisfies `interface S { go():
// number }` by having a `go`, and `implements` is an assertion for the reader
// rather than a requirement. This compiler's dispatch is **nominal**:
// `callee_for` emits `Callee::Virtual` only where `hierarchy.overridden` and
// `slot_for` agree, and the edge they need is written by `implements`.
//
// # It is the same gap as three other rows
//
// Written down here because the shapes look unrelated and the cause is one.
//
//   * `an-iterable-behind-an-interface` --- a class with `*[Symbol.iterator]()`
//     iterates when named by its class and refuses when named by an interface,
//     user-written or `Iterable<T>`. Nothing declares `implements Iterable<T>`,
//     because nothing has to.
//   * `a-byte-length-through-a-view-union` --- `ArrayBufferView` has no layout,
//     and every typed array satisfies it structurally.
//   * `a-member-of-X-a-class-this-compiler-has-no-type-for` is *not* this one;
//     that is `never[]`, and it has its own fixture. Ruled out rather than
//     assumed.
//
// # Fields are not affected, which narrows it
//
// Measured, one factor at a time. A class passed where a structural interface
// wants **fields** lowers in every spelling tried:
//
// ```text
// interface S { a: number }         class C { a = 1 }              lowers
// extra field on the class                                          lowers
// declaration order reversed                                        lowers
// an optional member on the interface                               lowers
// interface S extends A                                             lowers
// a subclass passed in                                              lowers
// ```
//
// So a field read through a structural type resolves by *name to offset* and
// needs no edge, while a call needs a slot and a slot needs a root to be
// numbered against. That is the boundary, and it is why this refuses while the
// six above do not.
//
// # What closing it means
//
// Either dispatch that does not need the edge --- a lookup by name at the call,
// which costs every interface call something --- or an edge inferred from
// structural satisfaction, which is a whole-program question: every class that
// has a `go` would become an implementor of every interface declaring one.
// `collect_interfaces` builds `hierarchy.implements` from the `implements`
// clause today, and `root_declaring`'s doc explains why the slot loop needs
// interfaces to be in `declares` at all.
//
// Neither is small, and the cheap thing a reader will reach for --- registering
// interface members in the hierarchy --- is recorded as measured-and-wrong in
// `an-iterable-behind-an-interface`: it turns the refusal into a
// `Callee::Direct` to a function nobody wrote.

interface S {
  go(): number;
}

class C {
  go(): number {
    return 3;
  }
}

function take(s: S): number {
  return s.go();
}

export function used(): number {
  return take(new C());
}
