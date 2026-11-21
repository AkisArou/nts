// **Reaches its `try`.** A `throw` from a function held in a `const` whose
// initialiser is not a function -- one made at run time, or bound -- is
// caught by the `try` around its call, as node catches it.
//
// No walk follows `const g = make()` to a body, so `g` is in no `throwing`
// set. `calls_compiled_code` asks `a_value_held_callee` of it, as of a
// parameter: a callee that holds a value arriving at run time can raise, so
// the `try` keeps its handler (#478). Before, only a parameter was asked, and
// this ended the program with `nts: uncaught Error: over 3`.
// `tests/programs/a-throw-through-call-or-apply-inside-a-try` is the
// `call`/`apply` spelling of the same question.
//
// Each throwing observation has its own control: `g(1)` and `b(1)` do not
// throw.
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
