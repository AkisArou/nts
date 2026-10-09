// **Escapes its `try`.** A `throw` from a function held in a `const` whose
// initialiser is not a function -- one made at run time, or bound -- ends the
// program (`nts: uncaught Error`) where node catches it.
//
// `calls_compiled_code` answers "cannot raise" for `g()` here: no walk follows
// `const g = make()` to a body, so `g` is in no `throwing` set. A parameter
// callee has the same shape, and for it the answer is "can raise". Answering
// that for a `const` too is one line, and it was measured on 2026-10-10: in the
// runtime modules, where some closure holds the raising gate off, every `try`
// around such a call then refuses instead of compiling. Twenty modules lost
// between 4 and 52 emitted functions each, about 660 in all, to turn a stop
// with a message into a refusal. So that line waits for the gate. The fix is
// to carry these raises where it is off now (`what_holds_the_gate_off`), after
// which the rule costs nothing. `examples/a-throw-through-call-or-apply-inside-a-try`
// is the half that landed.
//
// Both observations are `returned` under nts and the message under node, and
// each is its own control: `g(1)` and `b(1)` do not throw.
function failing(v: number): number {
  if (v > 3) {
    throw new Error("over 3");
  }
  return v;
}

function make(): (v: number) => number {
  return failing;
}

function madeAtRunTime(v: number): string {
  const g = make();
  try {
    return String(g(v));
  } catch (e) {
    return (e as Error).message;
  }
}

function bound(v: number): string {
  const b = failing.bind(null, v);
  try {
    return String(b());
  } catch (e) {
    return (e as Error).message;
  }
}

observe("made, under", madeAtRunTime(1));
observe("bound, under", bound(1));
observe("made, over", madeAtRunTime(5));
observe("bound, over", bound(5));
done();
