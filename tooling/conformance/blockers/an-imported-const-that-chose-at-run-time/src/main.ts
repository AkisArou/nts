// expect: NTS1001 a module-scope name holding a function, whose closure layout its initializer does not fix
//
// **This refusal replaced a silent wrong answer across a module boundary**, which
// is where the one `97584f66` closed did not reach. `use` below called `first` --
// the first-*declared* of the two, whichever arm the condition picks -- and 27 of
// 29 cases disagreed with node. The program compiled, ran and answered.
//
// `CallTarget::callee` is the checker's `getResolvedSignature().declaration`, and
// two functions of one shape are **one type**: the checker keeps one candidate and
// naming it is a guess. `97584f66` distrusted that guess for a name declared by a
// variable whose initializer chose -- and an imported name is declared by an
// *import specifier*, so the guard asked about the wrong symbol and answered "not a
// variable". Its doc said imports were untouched deliberately, which is right for
// an imported function and wrong for an imported `const`.
//
// The fix follows the alias to whatever declares the name, wherever it is. That is
// the shape that matters: React's jsx runtime publishes `jsx` through
// `export { jsx, jsxs } from "./jsx/ReactJSXElement.ts"` and every compiled
// component calls it through that re-export, so the same-module case the first
// guard covered is the one nobody writes.
//
// # The controls, each differing in one thing
//
//     viaDecided  the same shape with a condition the checker *decides* -- `const
//                 yes = true`. It compiles, calls `first` directly and agrees with
//                 node, because a decided conditional names exactly one function.
//                 It is what says this refusal is about not knowing rather than
//                 about conditionals. `examples/a-re-exported-const-that-chose` is
//                 the same arm as a running fixture, and it disagrees with node on
//                 any compiler built before the fix.
//     viaPlain    an ordinary function through the same re-export, still a direct
//                 call. Without it, a guard that simply distrusted every imported
//                 callee would pass this fixture while making every cross-module
//                 call indirect.
//     viaBorrowed `export const borrowed = outside`, a `const` naming a function
//                 declared in a *third* file. One candidate, so it is settled --
//                 but only if the name it resolves is followed through its own
//                 import specifier. Reading the diff is what found that: the first
//                 version answered "no function declaration here" and refused a
//                 call that had always worked.
//
// # What closing it needs
//
// A module-scope `const` holding a function, dispatching through the global,
// whatever its initializer -- the feature `storable` names and declines. Until
// then the refusal is the honest answer, and the same sentence covers
// `blockers/a-const-that-chose-between-two-functions` one module in.

import { chose, decided, plain, borrowed } from "./surface.ts";

/** The subject: an imported name whose initializer chose at run time. */
export function use(x: number): number {
  return chose(x);
}

/** **Control.** The decided sibling: compiles, and agrees with node. */
export function viaDecided(x: number): number {
  return decided(x);
}

/** **Control.** An ordinary imported function. */
export function viaPlain(x: number): number {
  return plain(x);
}

/** **Control.** A `const` naming an imported function: still a direct call. */
export function viaBorrowed(x: number): number {
  return borrowed(x);
}
