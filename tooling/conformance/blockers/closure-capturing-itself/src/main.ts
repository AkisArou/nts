// expect: `once`, captured above its own declaration, where it has no value yet
//
// A closure that names itself. `capturesEarlier` captures a binding declared
// above it and lowers; `capturesItself` captures the `const` it is being
// assigned to, and does not.
//
//     const add  = (n) => { total += n; }              -> lowers
//     const once = (n) => { total += n; drop(once); }  -> REFUSED
//
// `capturesEarlier` is the control. Without it the diagnostic reads as "a
// closure capturing a local is refused", which is false and would point at
// closures generally.
//
// 37 distinct sites in `runtime/node`, counted as sites rather than summed over
// cones. It is the self-removing listener, which is how `once` is written
// everywhere it appears -- `events/src/main.ts:1322`:
//
//     const eventListener = (...args: unknown[]): void => {
//       removeEventSourceListener(emitter, name, eventListener);
//       ...
//     };
//
// and `console/src/main.ts:437` reaches it a different way, through a helper
// used above its own `const`. A listener that unsubscribes itself cannot be
// written without naming itself, so this is not a spelling that can be avoided.
//
// # What closing it takes, built twice and reverted twice (2026-09-24)
//
// **The lowering is three lines and they are not the obstacle.**
//
//   1. `collect_closures` already makes a capture a *cell* when the captured
//      name's declaration sits **after** the closure. A closure's own name is
//      the same situation -- the binding has no value when the closure is built
//      -- missed only because the declaration is not below the arrow but
//      *around* it. One condition covers both: `declared.span.end >=
//      arrow.span.end`. `capturesEarlier` below is the arm that fails if it is
//      widened further, since an ordinary prior declaration ends before the
//      arrow starts.
//   2. `closure_bound_to` matches only an `ARROW_FUNCTION` initializer where
//      `collect_closures` accepts a `FUNCTION_EXPRESSION` too, so the
//      `function` spelling cannot resolve.
//   3. `open_cell_early` typed the cell from the checker's *signature* type
//      rather than the synthetic closure class. **This one is fixed** -- it was
//      a separate bug with no self-reference in it, reachable by any forward
//      capture, and it landed in `3e484b1f` with
//      `examples/a-guarded-cell-read-in-a-branch`. The JVM verifier
//      (`VerifyError: Bad type on operand stack`) and clang (`PHI node entries
//      do not match predecessors`) were both already rejecting it while C
//      agreed with node.
//
// With all three, this fixture lowers and **agrees with node on C, LLVM and the
// JVM**. It was committed and reverted, because:
//
//     NTS_RC=1   the program was killed by signal 11
//
//     const once = (n) => { total += n; drop(once); }   cycle   SEGFAULT
//     const add  = (n) => { total += n; }               cell    fine
//
// **The obstacle is ownership, not layout.** The closure is stored into its
// cell and its environment holds that cell, so the two own each other;
// reference counting frees one and leaves the other pointing at it. A segfault
// is worse than this refusal, and `rc` is a gate step rather than an
// experiment -- `NTS_RC_NAIVE` is presence-checked and the shipping build is
// the one with it unset.
//
// So closing this needs a **weak edge or a collector**, and this compiler has
// neither. That is a larger and better-aimed piece of work than the three lines
// above, and it is the reason to leave those three lines unapplied: they turn a
// refusal into a crash.
//
// The gate says it in two places, and the second is the one to read:
//
//     FAILED: jvm   11 example(s) compared only part of their cases, ceiling 10
//     FAILED: rc    actually failing: closure-capturing-itself
//
// The first is this fixture declining 17 of 58 cases, which is its own reason
// not to promote it to `examples/` unchanged.

function register(f: (n: number) => void): void {
  f(1);
}

function unregister(f: (n: number) => void): void {
  f(0);
}

export function capturesEarlier(seed: number): number {
  let total = seed;
  const add = (n: number): void => {
    total += n;
  };
  register(add);
  return total;
}

export function capturesItself(seed: number): number {
  let total = seed;
  const once = (n: number): void => {
    total += n;
    unregister(once);
  };
  register(once);
  return total;
}
