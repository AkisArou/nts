// expect: a link after an optional access

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
//
// `ends_an_optional_chain` now answers for all six, asked from the property,
// call and index link sites, and recursing through a chain's base rather than
// testing the node in front of it.
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
