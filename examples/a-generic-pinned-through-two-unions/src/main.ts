// A generic function called **from inside another generic function's body**,
// where the callee's type parameter is pinned by the caller's.
//
// `outer<S>` calling `inner(initial)` has nothing a copy can be made for at the
// call as written: `inner`'s `S` is bound to `outer`'s `S`, which is not a type
// anything can be compiled for. It is a type in `outer<f64>`, where it is
// `number`, and in `outer<string>`, where it is not -- so the copy is decided by
// the copy the call is *written in*, and one call node names two different
// callees.
//
// That is the same sentence `generics::GenericFunctions::at_call_in` already
// carried for a generic *class*, and the reason it took a second map rather than
// a second entry in that one is the key: a class's instantiation **is** a
// `TypeId`, and a generic function's copy is a `(declaration, suffix)` pair.
// `Link<f64>` has an id; `outer<f64>` has a name.
//
// `Templates::bindings_of` says so in its own doc -- *"Only a class or interface
// parameter. A function's parameter is bound by its own call sites, which is the
// mechanism this one is an extension of rather than a case of"* -- and that
// sentence is true for a direct call and false for a call inside a generic body,
// because there the call site is in a copy.
//
// And it needs the **fixpoint**. A copy discovered while expanding one call is
// what lets the next expansion happen, so instantiation runs until it stops
// growing rather than once: `twoLinks` below is three links of chain and needs
// three passes. That loop was built and measured as a byte-identical no-op the
// day before this landed, and it was a no-op precisely because nothing consumed
// function copies yet.
//
// The reduction is the React lane's, from `useState<S>(initialState: (() => S) |
// S)` -- the shape of `useState`, `useReducer`, `useTransition` and
// `useActionState`, and the wall their whole component chain stopped at. It was
// `tooling/conformance/blockers/a-generic-pinned-through-two-unions` until this
// change, where its header carries the earlier half of the story: the union arm
// of `unify` binding `S` to a whole union and producing `outer<erased>`, a wrong
// copy rather than a missing one.
//
// # What each export earns
//
//     withValue      the subject: one link, the value arm of the union
//     withThunk      the same copy reached through the *function* arm
//     withText       a second instantiation, so two copies of `inner` exist and
//                    each caller copy must name its own -- naming one of them
//                    program-wide would put a string where an f64 is read
//     twoLinks       three links of chain, which only the fixpoint reaches
//     nested         the call inside a closure passed as a value, so nesting is
//                    ruled out as either cause or cure
//
// `inner` answers 1 for the function arm and 2 for the value arm, so the answer
// depends on the input rather than on the copy having been made at all.

class Box {
  v: unknown = null;
}

/** `S` is mentioned only inside a union, and nowhere in the return. */
function inner<S>(initial: (() => S) | S): number {
  const b = new Box();
  b.v = initial;
  if (typeof initial === "function") {
    return 1;
  }
  return 2;
}

/** One link out: `S` deferred to an enclosing *function*'s parameter. */
function outer<S>(initial: (() => S) | S): number {
  return inner(initial);
}

/** Two links out, which is what the fixpoint earns. */
function outermost<S>(initial: (() => S) | S): number {
  return outer(initial);
}

function render(component: () => number): number {
  return component();
}

export function withValue(start: number): number {
  return outer(start);
}

export function withThunk(start: number): number {
  return outer(() => start);
}

export function withText(word: string): number {
  return outer(word);
}

export function twoLinks(start: number): number {
  return outermost(start);
}

export function nested(start: number): number {
  function Counter(): number {
    return outer(start);
  }
  return render(Counter);
}
