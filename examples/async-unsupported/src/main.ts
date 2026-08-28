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

// `inner` has no `await`, so it lowers; `outer` has one and is refused as
// ``an `await` ``. Named for the `await` rather than for the `async`, because
// suspension is the construct that is missing -- `async` on its own is done.
//
// Kept as a pair so that a change which makes `outer` lower without
// implementing suspension fails here rather than somewhere quieter.
async function inner(n: number): Promise<number> {
  return n + 1;
}

export async function outer(n: number): Promise<number> {
  return await inner(n);
}

// Refused today as ``a `new` that does not produce an object``, which is a
// better diagnostic than the one it used to give. `Promise<number>` was
// unrepresentable, so this failed on the *type*; now it has a representation
// and fails on the constructor, which is the part that is actually missing.
//
// The executor is the hard half: `new Promise((resolve) => ...)` calls a
// function the constructor supplies, so `resolve` is a closure over the
// promise, and settling it has to reach back through that.
export function later(n: number): Promise<number> {
  return new Promise<number>((resolve) => {
    resolve(n);
  });
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
