// expect: NTS1001 a module-scope name holding a function, whose closure layout its initializer does not fix
//
// **This refusal replaced a silent wrong answer, and that is what the fixture is
// for.** Until 2026-09-26 `use(x)` below called **`first`** -- the first-*declared*
// function, whichever arm the condition picks -- and 27 of 29 cases disagreed with
// node: `use(0)` answered `1` where node answers `0`. The program compiled, ran, and
// lied.
//
// It is React's `export const jsx = __DEV__ ? jsxDEV : jsxProd`, upstream's own
// jsx-runtime, so a compiled React ran whichever of the two was written first. The
// React lane's inventory found four shapes of it in the natively compiled packages;
// `reportGlobalError = typeof reportError === "function" ? reportError : fallback` is
// the nastiest, because one candidate is a global with no body in the program.
//
// # Why it happened
//
// `CallTarget::callee` is the checker's `getResolvedSignature().declaration`, and two
// functions of one shape are **one type** -- the checker keeps one candidate, and
// naming it is a guess. `direct_callee` trusted it unless the name was a *local*
// binding, and a module-scope `const` has no `bindings` entry, so nothing objected.
// It now also distrusts a name whose declaring variable's initializer **chose**:
// anything but a single identifier, or a conditional nothing has decided.
//
// **`use(x)` compiles again, and correctly, and that is not this fixture going
// stale.** `const yes = true` makes the condition's checker type the *literal*
// `true`, so the initializer names exactly one function and the call is direct --
// to `second`, the arm the condition reaches, rather than to whichever candidate
// the checker kept. What still refuses is the **export** `chose`: a global holding
// a function, which is the gap named below and is a different sentence about the
// same line. The refusal this fixture records is that one.
//
// Its run-time sibling is `blockers/an-imported-const-that-chose-at-run-time`,
// where the condition is a call and nothing can decide it, one module out; and
// `examples/a-re-exported-const-that-chose` is the decided case as a fixture that
// *runs*, which disagrees with node on any compiler built before 2026-09-26.
//
// # The controls, each differing in one thing
//
//     aliased   `const kept = second` -- one candidate, an identifier initializer,
//               so resolving to it is *right*. It compiles, and it is what says the
//               guard is about choosing rather than about being a variable. If a fix
//               for this blocker makes `aliased` refuse, it went too far.
//     imported  a call to an imported function, whose symbol is declared by an
//               import specifier rather than a variable. It must stay a direct call:
//               the first formulation of the guard asked "does the name declare the
//               callee", which would have made **every** cross-module call indirect.
//
// # What closing it needs
//
// Not the refusal removed -- a module-scope name holding a function dispatching
// through the global, which is `storable`'s own words: the slot has to hold every
// closure that can reach it, and a closure's layout is its captures. Two arms are two
// layouts and one slot.

import { third } from "./other.ts";

function first(x: number): number {
  return x + 1;
}

function second(x: number): number {
  return x * 2;
}

const yes = true;

/** The subject: two candidates of one shape, and the condition decides. */
export const chose = yes ? second : first;

/** **Control.** One candidate, named by an identifier: still a direct call. */
const kept = second;

export function aliased(x: number): number {
  return kept(x);
}

/** **Control.** An imported function, declared by an import specifier. */
export function imported(x: number): number {
  return third(x);
}

export function use(x: number): number {
  return chose(x);
}
