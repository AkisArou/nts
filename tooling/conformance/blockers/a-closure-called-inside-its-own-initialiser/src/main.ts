// expect: `g`, captured above its own declaration, where it has no value yet
//
// The control for `a-closure-that-passes-itself-on`, and it must keep
// refusing: the closure is called while `const g = ...` is still being
// initialised, so its body reads `g` inside the temporal dead zone, which
// JavaScript answers with a `ReferenceError`. Capturing a binding before its
// initialiser finishes is only safe when the closure cannot run before it
// does; this is the shape where it can, and does. Called through `now`,
// because TypeScript itself rejects the closure called in place (TS2448); a
// function that calls what it is given is the case no checker sees.
function now(f: () => number): number {
  return f();
}

export function start(): number {
  const g: number = now(() => g + 1);
  return g;
}
