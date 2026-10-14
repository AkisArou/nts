// **A module-scope `const` holding a function, initialized by a call, is not
// initialized: the call never runs, and nothing says so.** `make(1)` counts
// its calls. `held`, a function-typed `const` whose initializer is
// `make(1)`, is never read. node runs the initializer and observes 1; nts
// observes 0. Nothing is refused and no diagnostic is printed: this is a
// silent wrong answer, a statement with an effect dropped from the module's
// evaluation.
//
// **Control**, in this file: the same call as a bare statement, `make(2)`,
// one line apart. It runs on both, so the second observation is one more than
// the first on each.
//
// Read, the same `const` is refused where it is read ("a module-scope name
// holding a function, whose closure layout its initializer does not fix",
// blockers/a-module-scope-const-holding-a-closure-a-factory-returned), and
// the initializer is still dropped with no line of its own: the build's
// diagnostics account for the statements that call the reader and not for
// the call that was the initializer. lower.rs's own note says why nothing
// catches it: "a global whose initializer was refused is used by no function
// at all". integrity.ts's top-level-kept rule asks about calls to a *refused*
// callee, and `make` is not refused.
//
// A global holding an object instead (`type F = { n: number }`, `make`
// returning `{ n }`) is initialized and agrees: it is the function-typed
// slot.
//
// **Measured the same** on da4a2a4a8 and efc71ad44 (recorded on the latter).
//
// **Found by the React lane** filing the factory blocker above: React's
// upstream child reconciler is two such `const`s
// (`createChildReconciler(true)` and `(false)`); their factory has no effect
// of its own, so there the cost is the refusal, not this.
//
// **Expected, confirmed under node:**
//
//     a function-typed const initialized by a call   1
//     a bare call (control)                         2
type F = () => number;

let made = 0;

function make(n: number): F {
  made += 1;
  return () => n;
}

const held: F = make(1);
observe("a function-typed const initialized by a call", String(made));
make(2);
observe("a bare call (control)", String(made));
done();
