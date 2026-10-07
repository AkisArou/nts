// expect: nothing refused -- FIXED, kept as a guard
//
// **FIXED by landing-1 (20eaa7d74, 2026-10-06), and kept as a guard**: it
// lowers and agrees with node on every case. The record follows unchanged.
//
//
// **A generic caller that pins a generic callee with an explicit type argument
// built as a union from its own type parameter pins nothing.** `update<S>` calls
// `reduce<S, Action<S>>`, where `Action<S> = ((previous: S) => S) | S`.
// `update<number>` is instantiated, but no `reduce<number, Action<number>>` is
// made, so `reduce` refuses as a generic no call pins down.
//
// **Control** (`updatePlain`, `reducePlain`): the same program with the type
// argument the caller's own `S` instead of the union. It compiles and agrees with
// node. The control has a callee of its own, so instantiating one cannot pin the
// other.
//
// Not `examples/a-generic-pinned-through-a-union`, which agrees: there the union
// is *inferred* from an argument. Here it is written as a type argument and has
// to be substituted from the caller's instantiation.
//
// **Found by the React lane**, measured on the unmodified runtime at 9533b3a5e62e.
// React's `updateState<S>` calls `updateReducer<S, (() => S) | S,
// BasicStateAction<S>>(…)`, and `rerenderState` calls `rerenderReducer` the same
// way. Both declarations refuse with this sentence (ReactFiberHooks.ts:1333 and
// :1568), so `useState` cannot update a state even once the generic reducer it
// passes as a value (`blockers/a-generic-function-passed-as-a-value`) lowers.
type Action<S> = ((previous: S) => S) | S;

function reduce<S, A>(reducer: (state: S, action: A) => S, state: S, action: A): S {
  return reducer(state, action);
}

function update<S>(state: S, action: Action<S>): S {
  return reduce<S, Action<S>>((s, _a) => s, state, action);
}

export function run(): number {
  return update<number>(1, 5);
}

/** **Control.** The type argument is the caller's own `S`, and this compiles. */
function reducePlain<S, A>(reducer: (state: S, action: A) => S, state: S, action: A): S {
  return reducer(state, action);
}

function updatePlain<S>(state: S, action: S): S {
  return reducePlain<S, S>((s, _a) => s, state, action);
}

export function runPlain(): number {
  return updatePlain<number>(1, 5);
}
