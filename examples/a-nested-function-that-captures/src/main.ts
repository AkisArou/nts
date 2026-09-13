// A nested `function` declaration reading a local of the function that declares
// it.
//
//     function outer(columns) {
//       function inner(i) { return i * columns }      REFUSED until 2026-09-13
//     }
//
// # It is a desugaring, and that is what made it findable
//
// The same body written either of the other two ways lowered all along:
//
//     const visit = function (i) { return i * columns }   lowers
//     const visit = (i) => i * columns                    lowers
//
// So a nested `function` declaration is exactly a **hoisted `const` holding a
// function expression**, and every piece of capture machinery it needs already
// existed. What was missing was the desugaring.
//
// # Five places, and the fifth pointed at a sixth
//
// `collect_closures` had to take it, the declaration loop had to stop emitting a
// top-level function for it, the statement had to allocate and bind, the call
// site had to route through the binding, and `reached_by_name` had to keep
// answering for module scope.
//
// Four of those were right the first time and the call site still resolved
// directly — because a `FUNCTION_DECLARATION` node **carries no symbol**; its
// name child does, and that is the symbol every call site resolves to. Binding
// under the declaration's own symbol bound under `None` and returned before the
// allocation ever ran, so the closure body was never requested either and the
// only visible symptom was a call to a function that no longer existed.
//
// # `recursive` is the arm the row's own case needs
//
// The allocating side binds the name in the *enclosing* function, which is
// where `down(3)` resolves. A recursive `down(k - 1)` is inside the body, where
// that binding does not reach — so inside its own body the name is bound to the
// receiver, which *is* the closure. The row's motivating site is "a recursive
// matcher closing over `columns` and `memo`", so an example without this arm
// would miss the case the work was for.
//
// # What it costs the corpus
//
//     util   5 -> 1     net   21 -> 1     assert 4 -> 0
//     stream 21 -> 0    http  24 -> 1
//
// enclosing-scope refusals, with module totals falling 4 to 30 as the cascades
// behind them clear. Nothing went up.
//
// # What is still refused
//
// A nested function that **binds its own `this`** — `function f(this: T, …)` or
// one whose body mentions `this` — is not a closure by the same test the
// `function` *expression* arm uses, and stays a plain function. That is the
// whole of what remains in the corpus: `util`'s one is `promisified`.
//
// And **use before the declaration**, which is hoisting. A declaration is
// usable above its textual position and a `const` is not, and this captures *by
// value* at the allocation — so hoisting the allocation to the top of the block
// would capture locals that do not have their values yet. Not a limitation of
// the desugaring but of capture-by-value, and
// `blockers/enclosing-scope-name-in-a-nested-function` holds it.

/** Captures a local and is called directly. */
export function captures(columns: number): number {
  function visit(index: number): number {
    return index * columns;
  }
  return visit(2);
}

/** Captures and **recurses** — its own name, inside its own body. */
export function recursive(n: number): number {
  const step = (n & 3) + 1;
  function down(k: number): number {
    if (k <= 0) return 0;
    return step + down(k - 1);
  }
  return down(3);
}

/** Captures and is passed as a value rather than called by name. */
export function asValue(n: number): number {
  const base = n & 7;
  function make(k: number): number {
    return base + k;
  }
  const run = (f: (k: number) => number): number => f(2);
  return run(make);
}

/**
 * The control: nested, reads nothing from around it.
 *
 * It stays a plain function and always did. Taking *every* nested declaration
 * as a closure — rather than only one that captures — left 210 `a declaration
 * outside every walk` in `util` alone, a body nothing emitted and nothing
 * refused, so this arm is what keeps that distinction honest.
 */
export function noCapture(n: number): number {
  function twice(k: number): number {
    return k * 2;
  }
  return twice(n & 7);
}

/** The control at the other end: a module-scope function is not a closure. */
function atModuleScope(k: number): number {
  return k + 1;
}
export function callsModuleScope(n: number): number {
  return atModuleScope(n & 7);
}
