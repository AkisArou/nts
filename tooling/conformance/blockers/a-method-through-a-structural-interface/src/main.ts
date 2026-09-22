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
//
// # The second of the two was built and measured, 2026-09-22
//
// **The edge inferred from structural satisfaction, and it costs more than it
// buys.** A class implements an interface when it declares every method the
// interface does and each one has the same *shape* --- parameters and result
// as representations, which is the question a dispatch table asks. That much
// works: this fixture lowers and agrees with node on every case.
//
// Over 25 modules of `runtime/node`, against the same tree without it:
//
//     NTS1001 sites       1,346 -> 1,348      0 gone, 2 new
//     definitions        29,444 -> 29,430
//     NTS1001            14,939 -> 14,999
//
// **Zero sites cleared.** The two new ones carry 60 occurrences of `a `X`
// where a `X` is wanted, which is a pointer cast between two structs that do
// not agree about where their shared fields are` --- the hazard the fixture's
// own paragraph names: an inferred edge makes a class descend from an
// interface whose layout is not its prefix, and an upcast that is free for a
// declared base is a cast between unrelated structs here.
//
// So the corpus's interface calls are not waiting on the edge. They are
// waiting on something else, and the 104 sites that read `no class in this
// program implements it` are mostly satisfied by **object literals** ---
// `readonly urls: URLParser` in `runtime/web-platform`'s providers --- which
// have nowhere to write `implements` and no layout that is a prefix of the
// interface's either. Whatever closes this has to answer the layout question
// first; the edge is not the hard half.
//
// It did find a real defect on its way out. `declare_interface_methods`
// checked "already declared" against `program.funcs` and not against the
// shells it had itself queued, so two dispatch roots that `hierarchy.name`
// spells alike declared the method twice --- `DuplicateFunction`, and six
// node modules emitting nothing at all. Latent in the tree as it stands, and
// now a unit test: `two_roots_of_one_name_declare_one_shell`.

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
