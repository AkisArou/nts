// expect: NTS1001 a parameter of unrepresentable type (the type parameter `S`)
//
// A generic function handed to another function **as a value** never gets a copy
// at the substitution its receiving parameter implies. `updateReducer`'s
// `reducer: (state: S, action: A) => S`, called from `updateState<f64>`, pins `S`
// to `f64` and `A` to `((p: number) => number) | number` -- and nothing makes
// `basicStateReducer<f64>`, so the closure that stands for the function value is
// lowered at the declaration's types and its parameter is the bare `S`.
//
// **The expectation is that this line exists at all.** Until the closure's
// refusal was recorded under its own name, the cause was attributed to a source
// position and nothing else, so `nts refusals` -- a name-per-line view of
// `program.uncompiled` -- dropped it, and every caller read
//
//     updateState<f64>  it calls `Closure1#call`, which was refused above
//
// with nothing above. That is the third report of a hidden root in a week and the
// first one whose last link is a closure.
//
// # What closing it needs
//
// A function value's *receiving parameter* is a signature, and a signature says
// what its arguments are. So `updateReducer<f64, …>`'s `reducer` parameter is
// `(state: f64, action: …) => f64`, which is exactly the substitution
// `basicStateReducer` needs -- the copy is implied by the call and is made
// nowhere, because `function_instantiations` reads the *call's* type arguments
// and a value passed as an argument has none of its own.
//
// The reduction is the React lane's, from `ReactFiberHooks`. `basicStateReducer`
// is passed uncalled to `updateReducer(basicStateReducer, …)` and stored in
// `new UpdateQueue(basicStateReducer, …)`, which is why the whole `useState`
// chain -- `mountStateImpl`, `updateState`, `rerenderState` -- ends here.
//
// **Control:** `monomorphic`, the same program with the reducer and its caller
// written at `number`. It compiles, so the shape is the genericity and not the
// passing.

function basicStateReducer<S>(state: S, action: ((previous: S) => S) | S): S {
  return typeof action === "function"
    ? (action as (previous: S) => S)(state)
    : action;
}

function updateReducer<S, A>(
  reducer: (state: S, action: A) => S,
  state: S,
  action: A,
): S {
  return reducer(state, action);
}

export function updateState(state: number, action: number): number {
  return updateReducer(basicStateReducer, state, action);
}

/** **Control.** The same passing, monomorphic, which compiles. */
function plainReducer(state: number, action: number): number {
  return state + action;
}

function plainUpdate(
  reducer: (state: number, action: number) => number,
  state: number,
  action: number,
): number {
  return reducer(state, action);
}

export function monomorphic(state: number, action: number): number {
  return plainUpdate(plainReducer, state, action);
}
