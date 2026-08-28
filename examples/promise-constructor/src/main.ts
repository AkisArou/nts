// `new Promise(executor)`, which is refused — and which is in a file of its own
// for a reason worth writing down.
//
// The executor is the hard half: the constructor calls a function it supplies
// `resolve` to, so `resolve` is a closure over the promise, and settling has to
// reach back through it. That is a real piece of work and it is not done.
//
// # Why this is not in `examples/async-unsupported`
//
// A file containing `new Promise<T>` loses the payload of *every other promise
// in it*. With this function present, `inner`'s `Promise<number>` arrives from
// the checker with no type arguments at all, so it is refused as an
// unrepresentable result — and four functions that compile perfectly well on
// their own stop being tested.
//
// It is not the decomposition budget: raising it from 4,096 to 200,000 changes
// nothing. Something about the constructor changes what the checker reports for
// `Promise<number>` itself, and that is not yet understood. Isolating it here
// keeps one unexplained interaction from hiding the refusals the other file
// exists to check.
//
// What made it visible: a `Promise` with no recorded type arguments used to
// default to `Promise<void>`, which is a guess that reads as an answer. It is
// refused now, so this shows up as a diagnostic instead of as a promise that
// silently discards its value.
export function later(n: number): Promise<number> {
  return new Promise<number>((resolve) => {
    resolve(n);
  });
}
