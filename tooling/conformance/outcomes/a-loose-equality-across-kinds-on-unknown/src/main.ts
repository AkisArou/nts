// `==` between two `unknown`s of different kinds, which JavaScript answers by
// coercing -- a number against a boolean, `null` against `undefined`, and in
// the sweep an array against a number (not an arm here: `[]` as an argument
// is refused on its own, and a refusal would hide the answer). Every backend
// answers as if `==` were `===`.
//
// Before 093733f2d (`any` is an erased value, ...) this was refused by name:
//
//     NTS1001 `==` between values whose types are not known to agree, which
//     coerces -- and this compiler has no `ToPrimitive` to coerce with
//
// and its parent 5d738ca16 still refuses it, measured. From 093733f2d on it
// compiles, with no coercion. **Artefact:** tooling/sweep/run.sh, the `jvm`
// gate step's first half, has 126 of 12093 cases disagreeing on c, llvm and
// jvm alike -- every one a `loose_<a>_<b>` across two kinds, e.g.
//
//     nts  loose_num_bool 0 str 2,78,108      ("Nl": not equal)
//     node loose_num_bool 0 str 2,76,110      ("Ln": equal)
//
// **Control:** the same comparison between two values of one kind, which
// needs no coercion and agrees.
//
// **Expected, confirmed under node:** every arm `true`.
function loose(x: unknown, y: unknown): boolean {
  return x == y;
}
observe("number == number (control)", String(loose(1, 1)));
observe("0 == false", String(loose(0, false)));
observe("1 == true", String(loose(1, true)));
observe("null == undefined", String(loose(null, undefined)));
done();
