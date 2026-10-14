// expect: NTS1001 a module-scope name holding a function, whose closure layout its initializer does not fix
//
// **A module-scope `const` holding the closure a factory returns is refused
// where it is read.** `createReconciler` returns its inner `reconcile`, which
// reads the captured `track` and calls its sibling `mark`; `updating` and
// `mounting` hold one each. `render`'s read of them is the refused line, so
// both prints are cut: the program prints nothing, and node prints `ab` and
// `a*b*`. lower.rs names this case ("const f = pick() -- the same, from a
// call") as a feature not yet built, and no fixture pinned it: the two that
// carry this message are a method read off an instance
// (a-method-exported-as-a-value) and an imported `const` that chose at run time
// (an-imported-const-that-chose-at-run-time).
//
// **Control**, measured and not kept in this file: the same two `const`s
// declared inside `render` (without `export`) instead of at module scope, a
// two-line move and nothing else. It compiles on efc71ad44 and prints node's
// lines, so the factory, the capture and the sibling call all work; what is
// refused is the module-scope slot.
//
// **Found by the React lane.** This is upstream React's child reconciler:
// ReactChildFiber.js builds `reconcileChildFibers = createChildReconciler(true)`
// and `mountChildFibers = createChildReconciler(false)` at module scope. Our
// port writes it as a class, `ChildReconcilerImpl`, until this compiles. The
// class costs the JavaScript build: one `reconcileChildrenArray` shared by both
// modes leaves V8 in an on-stack-replacement deopt loop on list reorders, where
// the lane measured the swap scenario at 1.135x upstream's own build
// (2026-09-28). Upstream's shape gives each mode its own closures and does not
// loop.
//
// **Measured the same** on da4a2a4a8 and efc71ad44.
type Reconciler = (items: readonly string[]) => string;

function createReconciler(track: boolean): Reconciler {
  function mark(item: string): string {
    return track ? item + "*" : item;
  }
  function reconcile(items: readonly string[]): string {
    let out = "";
    for (const item of items) out += mark(item);
    return out;
  }
  return reconcile;
}

export const updating: Reconciler = createReconciler(true);
export const mounting: Reconciler = createReconciler(false);

function render(first: boolean, items: readonly string[]): string {
  return first ? mounting(items) : updating(items);
}

console.log(render(true, ["a", "b"]));
console.log(render(false, ["a", "b"]));
