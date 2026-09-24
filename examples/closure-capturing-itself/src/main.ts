// A closure that names itself. **Lowers as of 2026-09-24**; it was a blocker
// from before that, and the 37 sites this header counts are the reason it was
// worth closing rather than documenting again.
//
// `collect_closures` already made a capture a *cell* when the captured name's
// declaration sat **after** the closure, because the binding has no value when
// the closure is built. A closure's own name is the same situation, missed
// because the declaration is not below the arrow but *around* it. One condition
// covers both -- the declaration ends after the arrow does -- and
// `capturesEarlier` below is the arm that fails if it is widened too far, since
// an ordinary prior declaration ends before the arrow starts.
//
// Two narrower derivations of the same fact went with it: `closure_bound_to`
// matched only an `ARROW_FUNCTION` initializer where `collect_closures` accepts
// a `FUNCTION_EXPRESSION` too, and `open_cell_early` typed the cell from the
// checker's *signature* type rather than the synthetic closure class. The second
// is a separate bug with no self-reference in it, landed first with
// `examples/a-guarded-cell-read-in-a-branch`, because the JVM verifier
// (`VerifyError: Bad type on operand stack`) and clang (`PHI node entries do not
// match predecessors`) were both already rejecting it while C agreed with node.
//
// **The condition alone makes it worse**, and that version was built and
// reverted: every arm stops refusing and starts declining with
// `NTS2006 an object type with no layout`, which this project ranks below a
// refusal. Recorded because a reader who applies the condition and stops there
// will conclude the idea was wrong.
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
