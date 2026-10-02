// A pattern position past the end of its array is `undefined` -- where the element has room
// for one.
//
// `const [a, b] = [1]` **stopped the program** before this: *"an index its `!` promised was in
// range and was not"*, where node answers `undefined`. A run-time decline on ordinary code, and
// the thing that blocked the nested half of `1005fe5b1` -- `function f([{ x }]) {}` called
// `f([])` has to read element 0 to know it is absent, and that read is what declined.
//
// # Only where the element has room for an absence, and that is not a shortcut
//
// A `number[]`'s element is a double. `const [a, b]: number[]` declares `b: number`, so
// answering `undefined` there would be a lie at the type the program wrote, and the decline is
// the honest answer -- it stays. So this costs nothing in the runtime corpora, whose arrays are
// typed, and everything in test262, whose arrays are JavaScript's and erase. The arms here are
// all `any[]`, which is what a JavaScript array is.
//
// # The machinery was already there
//
// `defaulted_array_element` built exactly this branch -- a length test, the element on one side
// and `undefined` on the other, with a constant-length fold -- for `const [a = 1] = xs`, and
// returned `Ok(None)` when there was no default. The change is that the no-default case is the
// *first* branch alone: the second is what a default adds, and with none there is nothing for
// it to choose between.
//
// `withADefault` is the arm that says the default still wins, because the two paths now share
// a branch and a change to one could silently answer for the other.

/** An erased element: the array is `any[]`, which is what a JavaScript array is. */
export function shortErasedArray(n: number): number {
  const xs: any[] = [1];
  const [a, b] = xs;
  let out = 0;
  out += a === undefined ? 1 : 2;
  out += b === undefined ? 10 : 20;
  return out + (n & 7);
}

/** The control: long enough, so neither element is past the end. */
export function longEnoughErasedArray(n: number): number {
  const xs: any[] = [1, 2];
  const [a, b] = xs;
  let out = 0;
  out += a === undefined ? 1 : 2;
  out += b === undefined ? 10 : 20;
  return out + (n & 7);
}

/** Three positions past the end of an empty array. */
export function pastTheEndTwice(n: number): number {
  const xs: any[] = [];
  const [a, b, c] = xs;
  let out = 0;
  out += a === undefined ? 1 : 0;
  out += b === undefined ? 2 : 0;
  out += c === undefined ? 4 : 0;
  return out + (n & 7);
}

/** And a default still wins over the absence, which is the arm that already worked. */
export function withADefault(n: number): number {
  const xs: any[] = [1];
  const [a, b = 99] = xs;
  let out = 0;
  out += a === undefined ? 1 : 2;
  out += b === 99 ? 10 : 20;
  return out + (n & 7);
}
