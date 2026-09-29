// expect: NTS1001 `==` between values whose types are not known to agree, which coerces -- and this compiler has no `ToPrimitive` to coerce with
//
// `==` between two `unknown`s of different kinds, which JavaScript answers by
// coercing: `0 == false`, `1 == true`, `null == undefined` are all true.
//
// Refused by name until 093733f2d, which compiled it with no coercion and gave
// `===`'s answer on c, llvm and jvm alike -- 126 cases of tooling/sweep, and
// this fixture's first life as an outcomes wrong-answer record. d53d5a6cc
// restored the refusal (an erased value cannot be shown to agree with another)
// and the record moved here. FIXED, when it comes, should mean Abstract
// Equality over the tags (`nts_value_loose_eq`), not the strict answer again.
// The control is the same `==` within one kind, which agrees.
//
// **A temporary home, not a permanent gap.** A blocker that starts compiling
// reads FIXED, which is a note; an outcomes record that changes reads CHANGED,
// which is red. Loose equality is implementable, so whoever builds
// `nts_value_loose_eq` should turn this back into an outcomes record in the
// same commit, where a strict answer returning would fail rather than pass.
function loose(x: unknown, y: unknown): boolean {
  return x == y;
}
if (loose(1, 1) !== true) throw new Error("1 == 1 (control)");
if (loose(0, false) !== true) throw new Error("0 == false");
if (loose(1, true) !== true) throw new Error("1 == true");
if (loose(null, undefined) !== true) throw new Error("null == undefined");
