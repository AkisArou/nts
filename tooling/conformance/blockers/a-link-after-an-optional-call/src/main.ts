// expect: nothing refused

// **Lowered, 2026-09-25, and this is now a guard.** `a?.b.c`, `a?.b?.c()`,
// `a?.p[i].q` and the rest are one short-circuit over the whole chain
// (`lower_chain`): each `?.` tests its receiver, innermost first, and the rest
// of the expression is lowered in the arm where it is present, that link
// standing for the receiver the test read -- the design described below,
// with the narrowed links a map rather than one slot. All 203 cases across
// the seven functions here agree with node (MainClaude, against one tree and
// two binaries), and LLVM declines none of them.
//
// What is left is the cost the section below names: an index link inside the
// arm still takes the chain's type, so `a?.p[i]` reads its element through
// `erase` and `nts_array_element`. It is not stripped, because under
// `noUncheckedIndexedAccess` the index's own `undefined` and the chain's are one
// type in one union, and removing both would turn `a?.p[i] ?? d` with an index
// out of range from `d` into a trap. Correct and slower, not wrong.
//
// What follows is the record of why the guard exists, kept as it was.

// A non-optional link after an optional one. `a?.b.c` short-circuits the
// *whole* chain in JavaScript: when `a` is absent, `.c` is never evaluated.
//
// `typescript.md` row 244 said this was "refused and named" and it was not.
// The rule lived inline in `lower_property_access` and tested one thing -- is
// my object a *property access* whose second child is `?.` -- under a comment
// stating its own precondition: "all twenty-six optional accesses in the node
// profile are a single link". That was true when it was written and false the
// day `a?.b()` landed, because an optional call is a `CallExpression`, which
// that test cannot see. `lower_method_call` had no test at all.
//
// Six shapes were reaching code generation. None was refused and none was
// right. Measured against node on 2026-09-18:
//
//     a?.m().p       9 of 29 cases disagree -- answers 3 where node says -1
//     a?.m().m2()    the compiled program aborts, 9 times
//     a?.p.m()       the compiled program aborts, 9 times
//     a?.p[i].q      5 of 29 cases disagree
//     a?.p[i]        C aborts on every absent input; the JVM answers
//     a?.m()[i]      the same
//     a?.s[i]        **segfault**, signal 11, on every backend
//
// `ends_an_optional_chain` now answers for all seven, asked from the property,
// call and index link sites, and recursing through a chain's base rather than
// testing the node in front of it.
//
// # Lowering them, and why that is not here yet
//
// The design is known and was built far enough to be measured:
// `optional_chain_base` finds the **innermost** link, and one test is built
// there with the rest of the expression re-lowered *inside the present arm*,
// that link standing for the narrowed receiver. The narrowed links have to be a
// **stack** rather than one slot -- a two-link chain overwrote a single slot,
// the first link stopped standing for anything, lowering it branched again, and
// `outer?.inner?.items[0]` ended in `fatal runtime error: stack overflow`.
//
// That version passed every shape here on C and on the JVM, side-effecting
// arguments included. It is not landed because of what it does on **LLVM**: the
// element access inside the arm takes the *whole chain's* type, which is
// `T | undefined`, so a read that is `array.get unchecked` in the equivalent
// unchained program becomes `erase` plus `nts_array_element`, and 17 of 29
// cases then decline under LLVM while agreeing under C and the JVM.
//
// The pessimisation is the real objection and the divergence is its symptom: a
// link inside the present arm should be typed by *its own* result, not by the
// type of the chain that may short-circuit around it. Whoever takes this should
// start there rather than from the backend.
//
// # The fourth was found by a fixture, not by the matrix
//
// `a?.p[i].q` -- a property link on an index link on an optional link -- was
// missed by the first version of the rule, which recursed through a call's
// callee and not through an index's object. The example written to pin the
// boundary found it by disagreeing with node on 5 of 29 cases.
//
// # The fifth and sixth nearly went unrefused, twice, and that is the lesson
//
// An index link reads the element *after* the arms have merged, so it runs on
// the absent path:
//
//     b3(%6: managed<[f64]>):          <- both arms meet here
//       %7 = const 1
//       %9 = call.extern nts_array_element(erase %6, %7)
//
// On C that aborts -- `nts: refused: element of a non-array, which the lowering
// proved was an array` -- for every input taking the absent arm, with a
// constant index as much as a computed one. On the JVM it answers, because an
// element of `undefined` is `undefined` there and a trailing `??` folds it to
// the same answer the short-circuit would have given. Agreement by coincidence
// of the surrounding operator, on one backend.
//
// **The differential folds a decline into *skipped*, never into *disagreed*.**
// So `agreed on every case` is its last line while the line above it reads
// `17 case(s) the compiled program declined`. Two measurements read only the
// last line and reported these shapes as working on all three backends, and the
// example written to pin them as working was itself hollow -- 17 declines on C,
// and LLVM comparing 3 of 87 cases -- while printing `agreed on every case`.
//
// Driving the absent arm *exclusively* is what settles it, and the same
// instrument then says so in words: "no case was checked: all 17 declined, so
// the two sides were never compared. A program that stops on every input looks
// exactly like this."
//
// # What is not affected
//
// `a?.[i]` -- a *single* optional index -- still lowers. `lower_optional_element`
// passes the index node into the branch, so it is evaluated inside the present
// arm. That is exactly the shape all six of these want, and it is why the fix
// is one thing rather than six: the rest of the chain belongs inside the
// present arm rather than after the merge, which `Branch::Member` and
// `Branch::Element` already do for a single link.

export function propertyAfterAnOptionalCall(n: number): number {
  const s: string | undefined = n > 0 ? "abcd" : undefined;
  return s?.slice(1).length ?? -1;
}

export function callAfterAnOptionalCall(n: number): number {
  const s: string | undefined = n > 0 ? "abcd" : undefined;
  return s?.slice(1).charCodeAt(0) ?? -1;
}

export function callAfterAnOptionalProperty(n: number): number {
  const o: { b: string } | undefined = n > 0 ? { b: "abcd" } : undefined;
  return o?.b.charCodeAt(0) ?? -1;
}

// A tuple rather than an array, because this directory's config sets
// `noUncheckedIndexedAccess` and `examples/` does not -- under it `names[1]` is
// `string | undefined` and the arm would be a type error rather than a lowering
// one. Writing `!` would have silenced it and thrown away the question.
export function propertyAfterAnIndexAfterAnOptionalLink(n: number): number {
  const o: { names: [string, string] } | undefined =
    n > 0 ? { names: ["ab", "cde"] } : undefined;
  return o?.names[1].length ?? -1;
}

export function indexAfterAnOptionalProperty(n: number): number {
  const o: { items: [number, number] } | undefined =
    n > 0 ? { items: [n, n * 2] } : undefined;
  return o?.items[0] ?? -1;
}

export function indexAfterAnOptionalCall(n: number): number {
  const a: number[] | undefined = n > 0 ? [n, n + 1, n + 2] : undefined;
  return a?.slice(1)[0] ?? -1;
}

// The seventh, and the worst of them: a **string** index after an optional
// link. It was not merely unrefused -- the compiled program **segfaults**,
// signal 11, on 9 of 29 cases, on C and LLVM and the JVM alike. Not a decline,
// not a wrong number, a crash.
//
// It escaped the guard for a structural reason worth keeping: the guard sat
// *below* `lower_string_index`, so the dispatch had already decided what kind
// of index this was before anything asked whether the index runs at all. The
// six above are property and call links, which are dispatched later, so the
// same guard covered them and missed this one. The chain question now goes
// first.
export function stringIndexAfterAnOptionalLink(n: number): number {
  const o: { label: string } | undefined = n > 0 ? { label: "abcd" } : undefined;
  return (o?.label[1] ?? "-").charCodeAt(0);
}
