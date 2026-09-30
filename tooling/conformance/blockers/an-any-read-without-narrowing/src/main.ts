// expect: NTS1001 `k` on `any`, which is erased here
//
// **The escape hatch, held shut.** `docs/any-unknown.md`'s plan names this arm as
// owed by *every* `any` slice and not once: a slice that makes any of the four
// below compile has accepted the hatch `representation_of`'s own comment was
// written to keep closed, and the whole design of erasing `any` rests on an
// unnarrowed use meeting exactly the refusals `unknown` already met.
//
// **It did not exist.** The plan referred to it by this name from the day slice 0
// landed, and nothing under `examples/`, `blockers/` or `outcomes/` carried it --
// so five commits of `any` work were checked against a guard that was a sentence.
// The three `any` fixtures that do exist (`anyview-into-unknown`,
// `anyview-readback-after-typeof`, `indexing-an-array-of-any`) all spell
// `expect: lowers`: they assert `any` **works**, which is the opposite direction.
// A row with no witness cannot flip, and nothing goes red when its subject
// quietly disappears -- the same defect that struck three A1 rows on 2026-09-30.
//
// # The four operations, and why each is refused rather than answered
//
// An `any` is `HirType::Erased`: a tagged value whose payload is whatever it
// holds. None of these can be compiled without knowing which:
//
//   v.k      a field needs an offset, and an erased value has no layout
//   v()      a call needs a signature, and there is none to read
//   v[0]     an index needs an element width
//   v + 1    `+` needs to know whether it adds or concatenates
//
// Each says so in its own words rather than through one shared sentence, which is
// what lets a census rank them -- and the messages are deliberately not prefixes
// of one another (`NotAPrefix`'s rule, one construct along).
//
// # The control, and it is the half that makes this a guard rather than a wall
//
// `narrowedFirst` tests the tag and then uses the value, and it **must go on
// compiling**. A rule that refused every use of an `any` would satisfy the
// expectation above and destroy the entire point of erasing it: slice 0's measured
// gain -- test262 language 4,632 -> 5,040 -- is made of programs that narrow.
//
// So this fixture fails in two directions, and both matter: if an arm below starts
// compiling, a slice has opened the hatch; if `narrowedFirst` stops compiling, a
// slice has closed the door it was supposed to open.
export function readsAProperty(v: any): unknown {
  return v.k;
}

export function callsIt(v: any): unknown {
  return v();
}

export function indexesIt(v: any): unknown {
  return v[0];
}

export function addsToIt(v: any): unknown {
  return v + 1;
}

// The control: narrowed by `typeof`, then used. Must compile.
export function narrowedFirst(v: any): number {
  return typeof v === "number" ? v + 1 : 0;
}
