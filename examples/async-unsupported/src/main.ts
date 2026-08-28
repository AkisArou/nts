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

// A second suspension point. The state dispatch is one comparison, so two
// states would need a chain -- and the second `await`'s resume block has to be
// reachable from it, which is the block renumbering this does not do yet.
export async function twiceAwaited(n: number): Promise<number> {
  const a = await inner(n);
  const b = await inner(a);
  return b;
}

// An `await` inside a branch. The function has more than one block, so the
// split is a graph rewrite rather than cutting one block in two.
export async function guardedAwait(n: number): Promise<number> {
  if (n > 0) {
    return await inner(n);
  }
  return 0;
}

// A value that outlives the suspension and is neither a parameter nor the
// result promise. It needs a frame slot of its own and every use rewritten to a
// load -- the general spilling. Dropping it instead would resume with whatever
// the register held, which is the kind of wrong that runs.
export async function carried(n: number): Promise<number> {
  const doubled = n * 2;
  const awaited = await inner(n);
  return awaited + doubled;
}
