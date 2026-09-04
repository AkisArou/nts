// The parts of `async` this lowering still refuses, each by name.
//
// `async` itself lowers now, for the shape that needs no suspension -- see
// `examples/async`, which asserts answers. This file is the other half: the
// constructs that are *not* implemented, kept separate because in
// `examples/unsupported` one refusal among many satisfies the test, and a case
// that produces *no* diagnostic hides behind the cases that do.
//
// That was not hypothetical here. `twice` used to lower silently and wrongly:
// `Promise<number>` became `void`, the multiply happened, and the result was
// converted to nothing --
//
//   export func twice(n: f64) -> void {
//     %2 = mul %0, %3 : f64
//     %4 = convert %2 : void    <- the return value, discarded
//     ret %4
//   }
//
// -- which the SSA verifier accepted. A caller got `undefined` where it asked
// for a number, with nothing said at compile time. It lowers correctly now and
// lives in `examples/async`.

// Both of these lower now -- one `await` in a straight-line body is compiled.
// They are kept because the *shapes* below are not, and a file of refusals
// wants the neighbouring case that works beside it.
async function inner(n: number): Promise<number> {
  return n + 1;
}

export async function outer(n: number): Promise<number> {
  return await inner(n);
}

// The three shapes refused *by name*, ahead of the blanket `async` rule.
//
// They are here rather than waiting for async to land because of the ordering:
// while `async` is refused wholesale these are refused with it, so a specific
// diagnostic added afterwards would be a rule with no case reaching it -- and
// the day the blanket comes off, each would silently start compiling as though
// the hard part were not there. The lowering checks them first, so they are
// live now, and this file is what says so.

// Two suspension mechanisms at once: the frame has to survive being resumed
// from a consumer and from an awaited promise both.
export async function* streamed(n: number): AsyncGenerator<number> {
  yield n;
}

// A loop whose *iteration protocol* suspends, so the suspension points are
// inside machinery the source never wrote.
export async function consumed(xs: AsyncIterable<number>): Promise<number> {
  let total = 0;
  for await (const x of xs) {
    total = total + x;
  }
  return total;
}

// A `finally` has to run on every path out of the try, including the one where
// the function suspended and came back with an exception -- which is the
// exception state machine rather than the value one.
export async function guarded(p: Promise<number>): Promise<number> {
  try {
    return await p;
  } finally {
    // Nothing here: it is spanning the `await` that is refused, not the body.
  }
}

// A promise settled *with* a promise: adoption. The outer one subscribes to
// the inner, waits, and takes its value -- two extra ticks that any
// interleaving can see. Storing the inner promise in the payload slot would be
// a different value of a different type.
//
// It was already an error, but the C compiler's, which reads as a defect in
// this compiler rather than as a construct it does not implement. And only the
// number payload was loud: `NtsPromise *` will not go where a `double` is
// wanted, but a reference payload would have compiled and settled with the
// wrong object.
export async function adopts(n: number): Promise<number> {
  return inner(n);
}

// `Promise.all` over an array of values rather than promises. Legal, and it
// fulfils with the values unchanged -- but deciding per element whether a
// value is a promise at all is a different mechanism from this one rather than
// a larger version of it.
export async function allOfPlainValues(n: number): Promise<number> {
  const values = await Promise.all([n, n + 1]);
  return values[0]!;
}

// A heterogeneous result. `Promise.all` of a `number` and a `string` is
// `Promise<[number, string]>`, and a tuple whose elements do not share a
// representation has none -- so this is refused by the type rather than by a
// rule of its own.
async function named(n: number): Promise<string> {
  return "n";
}

export async function allOfMixed(n: number): Promise<string> {
  const values = await Promise.all([inner(n), named(n)]);
  return values[1]!;
}
