// A nested `function` declaration that captures is lowered as a *closure body*,
// not as a function of this program: there is one of it per call of its
// enclosing function, carrying an environment. So a sibling closure that calls
// it has to **capture** it, exactly as it captures any other local holding a
// function -- and `reached_by_name` said the opposite, because its first
// sentence ("there is one of it for the whole program") is true of a top-level
// function and false of this one.
//
// The symptom was a cascade with no root: `Closure1#call` calling `inner`,
// "which nothing in this program defines", and nothing anywhere refused. The
// GTK lane found it porting Workbench's Network Monitor and the React lane
// found the same shape in upstream's child reconciler, whose ~24 inner
// functions call each other.
//
// On a compiler built before the fix this refuses six times and compares 58
// cases across 2 functions; here it compares 116 across 4 and agrees.

function run(f: () => number): number {
  return f();
}

/** The reported shape: the nested function is called directly *and* from a closure. */
export function viaClosure(n: number): number {
  function inner(): number {
    return n * 2;
  }
  return inner() + run(() => inner());
}

/**
 * The chain, which is why the answer is a fixpoint rather than a predicate.
 *
 * `c` captures `n`, so `c` is a closure; `b` calls `c`, so `b` captures a
 * closure and is one; `a` calls `b`. One pass over the declarations takes `c`
 * and leaves `b` emitted as a plain function calling a name nothing defines --
 * which is the original bug, one level in.
 */
export function viaChain(n: number): number {
  function c(): number {
    return n + 1;
  }
  function b(): number {
    return c() + 1;
  }
  function a(): number {
    return b() + 1;
  }
  return run(() => a());
}

/** The control that worked before: the same declaration, never read by a closure. */
export function viaDirect(n: number): number {
  function inner(): number {
    return n * 3;
  }
  return inner();
}

/**
 * The control that must not change: a nested function capturing nothing is an
 * ordinary function of this program, reached by name from a closure as from
 * anywhere. If this one started being captured, every program with a helper
 * function would carry it in a closure object for nothing.
 */
export function viaNoCapture(n: number): number {
  function pure(): number {
    return 7;
  }
  return run(() => pure()) + n;
}
