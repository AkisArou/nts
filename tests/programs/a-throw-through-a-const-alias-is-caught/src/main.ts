// A `throw` reached through a `const` that names a function is caught.
//
// `const alias = apply` is a name for `apply`, and call lowering calls `apply`
// through it -- but the throw analysis asked about `alias`, a symbol no set
// contained, so `try { alias(n, cb) } catch {}` lowered with no handler and a
// `throw` in `cb` ended the program where node caught it. With an annotation
// (`const typed: F = apply`) the `try` survived and the call still named
// `apply`'s ordinary entry: the checker's callee there is the annotation's
// signature, which has no raising copy. Both now resolve the alias the way the
// call does.

function apply(state: number, action: (p: number) => number): number {
  return action(state);
}
const alias = apply;
const typed: (state: number, action: (p: number) => number) => number = apply;

function guarded(p: number): number {
  if (p < 1) throw "negative";
  return p + 2;
}

export function throughAlias(n: number): number {
  try { return alias(n, guarded); } catch { return n - 10; }
}
export function throughTypedAlias(n: number): number {
  try { return typed(n, guarded); } catch { return n - 20; }
}
/** A generic function named by a typed alias: the alias's own instantiation. */
type Action<S> = ((previous: S) => S) | S;
function reducer<S>(state: S, action: Action<S>): S {
  return typeof action === "function" ? (action as (previous: S) => S)(state) : action;
}
const numberReducer: (state: number, action: Action<number>) => number = reducer;
export function throughGenericAlias(n: number): number {
  try { return numberReducer(n, p => { if (p < 1) throw "negative"; return p + 2; }); }
  catch { return n - 30; }
}

/** Through the alias with a callback that cannot throw: the ordinary path. */
export function nothingThrown(n: number): number {
  try { return alias(n, p => p * 2); } catch { return -2; }
}
