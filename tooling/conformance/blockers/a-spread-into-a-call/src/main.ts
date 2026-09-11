// expect: a spread element
//
// **Narrowed on 2026-09-11.** This fixture used to say that spreading into a
// *call* refused while spreading into an array literal worked, and that the
// argument position was the whole condition. Half of that is now closed: a
// spread whose **arity is known at compile time** is expanded into that many
// arguments, one indexed read each. `examples/a-fixed-arity-rest-is-positional`
// is the guard for it, and `spreadOfATuple` there is the function this file
// used to hold.
//
// What is left is the half where the count is not known:
//
//     const args: [number, number] = [4, 5];  add(...args)   lowers
//     const args: number[] = [4, 5];          add(...args)   refuses
//
// So the condition was never the argument position. It is whether the compiler
// can say how many arguments the call passes -- which it must, because the
// callee has a fixed parameter list and the count is what fills it.
//
// # Why it cannot simply be done
//
// The spread is a run-time length against a compile-time parameter list. Making
// it work means either a call whose argument count is decided at run time --
// which no backend here has, and which is the calling-convention change this
// compiler exists to avoid -- or a check that the length matches followed by a
// fixed call, which is a `throw` on a path TypeScript already proved safe for
// the tuple case and cannot prove for this one.
//
// Node's own modules spread arrays of statically-unknown length into calls
// rarely; where they forward arguments it is `f(...args)` with `args` a rest
// parameter, and a rest parameter of fixed arity is exactly the case that now
// works. So this is filed as the honest remainder rather than as the blocker it
// was: it went from covering every spread into a call to covering the ones
// whose count nobody knows.

/** Control: spreading into an array literal. Compiles, and agrees with node. */
export function spreadIntoAnArray(): number {
  const a = [1, 2];
  const b = [0, ...a, 3];
  return b.length;
}

/** Control: the half that was fixed. A tuple has an arity, so this lowers. */
export function spreadOfAKnownArity(): number {
  const add = (a: number, b: number): number => a + b;
  const args: [number, number] = [4, 5];
  return add(...args);
}

/** Under test: an array with no arity. The call has no count to fill. */
export function spreadOfAnUnknownArity(): number {
  const add = (a: number, b: number): number => a + b;
  const args: number[] = [4, 5];
  // @ts-expect-error a number[] cannot fill a two-parameter list
  return add(...args);
}
