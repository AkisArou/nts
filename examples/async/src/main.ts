// `async` functions, in the shape that needs no suspension.
//
// An `async` function with no `await` in it is an ordinary function whose
// returns settle a promise. That is the whole of what this file exercises, and
// it is a real slice rather than a stepping stone: the promise is allocated on
// entry, every `return` settles it and hands it back, and the function's type
// is `Promise<T>` rather than `T`.
//
// Suspension is here too, in general: several `await`s, `await` inside a branch
// or a loop, and values that outlive a suspension. The function becomes a state
// machine over a heap frame and the resumption runs from the microtask queue.
// What is still refused, by name, is an async generator, a `for await` loop and
// a `finally` spanning an `await` -- see `examples/async-unsupported`.
//
// These are driven by `nts check`, which calls the function, runs the loop to
// quiescence on the deterministic host, and compares what the promise settled
// with against what node's `await` produces.

// A number payload: settled through `nts_promise_fulfill_number`.
export async function twice(n: number): Promise<number> {
  return n * 2;
}

// No payload. Falling off the end of an `async` function resolves it with
// `undefined`, which is the same path a bare `return` takes rather than a
// special case beside it.
export async function nothing(n: number): Promise<void> {
  const ignored = n * 2;
  if (ignored < 0) {
    return;
  }
}

// A reference payload: a different `fulfill`, chosen from the payload's
// representation. Getting that choice wrong is a *compile* error in the emitted
// C rather than a silent corruption, because a double cannot be passed where
// the runtime wants an `NtsHeader *`.
export async function describe(n: number): Promise<string> {
  return n > 0 ? "positive" : "negative";
}

// Several returns, so the promise is settled from more than one path and the
// allocation still happens once.
export async function classify(n: number): Promise<number> {
  if (n < 0) {
    return -1;
  }
  if (n === 0) {
    return 0;
  }
  return 1;
}

// A return from inside a loop, which is the path where the settle has to
// terminate the block it is in rather than fall through to the next one.
export async function firstOver(limit: number): Promise<number> {
  for (let i = 0; i < 100; i++) {
    if (i > limit) {
      return i;
    }
  }
  return -1;
}

// A settled promise really is settled: nothing is left pending, so the loop
// has nothing to run and the value is there the moment the call returns.
export async function immediate(n: number): Promise<number> {
  return n;
}

// --- suspension ------------------------------------------------------------
//
// `await` is compiled, not called. The function is split at the suspension: a
// thin entry that allocates the frame and hands back a promise, and a resume
// function that the microtask queue calls when the awaited promise settles.
// The frame is an ordinary managed object -- a synthetic class, exactly as a
// closure is -- so it gets the layout, the descriptor, precise tracing and
// reference counting rather than a second mechanism for each.

async function increment(n: number): Promise<number> {
  return n + 1;
}

async function name(n: number): Promise<string> {
  return n > 0 ? "positive" : "negative";
}

async function ignore(n: number): Promise<void> {
  const unused = n;
}

// The commonest shape there is.
export async function forwarded(n: number): Promise<number> {
  return await increment(n);
}

// The awaited value is used after the resumption, which is the point of
// resuming at all.
export async function scaled(n: number): Promise<number> {
  const v = await increment(n);
  return v * 2;
}

// A *parameter* read after the suspension. It cannot be a C local across the
// resumption -- the C frame is long gone -- so it lives in the heap frame and
// every use of it after the split is a load.
export async function summed(n: number): Promise<number> {
  const v = await increment(n);
  return v + n;
}

// A reference payload, which settles and is read back through a different
// runtime accessor than a number.
export async function named(n: number): Promise<string> {
  return await name(n);
}

// Awaiting something that settles with nothing.
export async function awaitedNothing(n: number): Promise<void> {
  await ignore(n);
}

// --- suspension, in general -------------------------------------------------
//
// Each block is cut into segments at its `await`s. Segment zero keeps the
// block's parameters and is reached the ordinary way; every later segment is
// reached only from the state dispatch, so *nothing* dominates it -- which is
// why every value still needed on the far side lives in the frame, and every
// use of one is a load.

// Two suspension points. The dispatch is a chain of comparisons rather than one
// test, because the IR's only multi-way terminator is a two-way branch.
export async function twiceAwaited(n: number): Promise<number> {
  const a = await increment(n);
  const b = await increment(a);
  return b;
}

// A suspension inside a branch: more than one block, so the split is a graph
// rewrite rather than cutting a block in two.
export async function guardedAwait(n: number): Promise<number> {
  if (n > 0) {
    return await increment(n);
  }
  return 0;
}

// A value that outlives the suspension and is neither a parameter nor the
// result promise. It gets a frame slot of its own, a store where it is defined
// and a load at every use. Dropping it would resume with whatever the register
// held, which is the kind of wrong that runs.
export async function carried(n: number): Promise<number> {
  const doubled = n * 2;
  const got = await increment(n);
  return got + doubled;
}

// A suspension inside a loop, so the block it is in has a back edge. The loop
// counter is a block parameter of the header, and the segment after the
// suspension is dominated by nothing that defines it -- which the verifier
// caught as a jump carrying an argument the block could not name.
export async function looped(n: number): Promise<number> {
  let total = 0;
  for (let i = 0; i < 3; i++) {
    total = total + (await increment(i));
  }
  return total + n;
}

// A loop-carried value that also crosses the suspension.
export async function carriedLoop(n: number): Promise<number> {
  let acc = n;
  for (let i = 0; i < 2; i++) {
    acc = acc + (await increment(acc));
  }
  return acc;
}

// Suspensions with different payloads in one function, so the frame's single
// `awaited` slot is read back through a different accessor each time.
export async function mixedPayloads(n: number): Promise<number> {
  const text = await name(n);
  const num = await increment(n);
  return text.length + num;
}

// One `await` as the argument of another.
export async function nestedAwaits(n: number): Promise<number> {
  return (await increment(await increment(n))) * 2;
}

// --- `Promise.resolve` and `Promise.reject` --------------------------------
//
// Constructors rather than operations: each allocates a promise and settles it
// before anyone can subscribe. Already settled is not the same as synchronous
// -- a reaction on one of these still runs on the microtask queue, one tick
// later, because running it inline would be a different observable order.

export function alreadySettled(n: number): Promise<number> {
  return Promise.resolve(n + 1);
}

export async function throughResolve(n: number): Promise<number> {
  return await Promise.resolve(n * 3);
}

// Two settled promises awaited in sequence, so the state machine runs its
// dispatch twice over promises that never actually suspend anything.
export async function twoSettled(n: number): Promise<number> {
  const a = await Promise.resolve(n);
  const b = await Promise.resolve(a + 1);
  return b;
}

// A rejection. The reason is an object, and the runtime stores it in the same
// slot a reference payload uses -- which is spelled `NtsHeader *`, so an
// `Error` needs the cast that a string did not. That is why this case exists:
// `Promise<string>` worked and `Promise<number>` rejecting with an `Error` did
// not, which reads as one payload type failing while the rest pass.
export function refused(n: number): Promise<number> {
  if (n > 0) {
    return Promise.resolve(n);
  }
  return Promise.reject(new Error("not positive"));
}

// --- `Promise.all` and `Promise.race` --------------------------------------
//
// One machine with two dials: how many settlements it waits for, and whether
// it keeps the values. Both subscribe to every element, in order, before
// returning -- an element that settles during the call is not missed -- and
// both settle their result once.
//
// The tick that these exist to pin: `all` settles one microtask *after* its
// last element, because the element's reaction runs and then settling the
// result schedules its own. A combinator that resolved inline would return the
// same values and the wrong interleaving.

async function afterOneTick(n: number): Promise<number> {
  return await Promise.resolve(n);
}

async function afterThreeTicks(n: number): Promise<number> {
  let v = await Promise.resolve(n);
  v = await Promise.resolve(v);
  return await Promise.resolve(v);
}

export async function allOfTwo(n: number): Promise<number> {
  const values = await Promise.all([afterOneTick(n), afterOneTick(n + 1)]);
  return values[0]! * 1000 + values[1]!;
}

// The slow one is first in the array and settles last. Completion order and
// input order agree in most tests, which is exactly what lets a combinator
// that reports completion order pass them.
export async function allKeepsInputOrder(n: number): Promise<number> {
  const values = await Promise.all([afterThreeTicks(n), afterOneTick(n + 5)]);
  return values[0]! * 1000 + values[1]!;
}

// Fulfilled with an empty array before the call returns, rather than a tick
// later. Nothing is subscribed, so there is no reaction to wait for.
export async function allOfNone(n: number): Promise<number> {
  const none: Promise<number>[] = [];
  const values = await Promise.all(none);
  return values.length + n;
}

// A reference payload, which is a different `fulfill` and a different read.
// The read is why this case is here: the runtime hands back one erased
// reference for every payload, and the array is the first class C refuses to
// take it for -- a string and an object both compiled silently.
export async function allOfStrings(n: number): Promise<string> {
  const values = await Promise.all([describe(n), describe(-n)]);
  return values[0]! + "/" + values[1]!;
}

export async function raceTakesTheFirstToSettle(n: number): Promise<number> {
  return await Promise.race([afterThreeTicks(n), afterOneTick(n + 5)]);
}

// Both are settled, so the winner is subscription order, which is input order.
export async function raceOfSettled(n: number): Promise<number> {
  return await Promise.race([Promise.resolve(n), Promise.resolve(n + 1)]);
}

// --- Rejection ---------------------------------------------------------------
//
// A rejected promise holds a reason and no value, so both payload readers
// assert. `await` of one aborted the program until the resumption learned to
// test for it first -- a failure no test that only awaits successes can see.
//
// With no `try`/`catch` across an `await`, the only thing a rejection can do is
// reject this function's own promise, which is what these check. `nts check`
// compares that against node's, where the `await` throws and the rejection
// comes out of the async function the same way.

function rejects(n: number): Promise<number> {
  return Promise.reject(new Error("rejected on purpose"));
}

export async function awaitARejection(n: number): Promise<number> {
  const v = await rejects(n);
  return v + 1;
}

// The rejection arrives at the *second* resumption, so the state machine has
// already dispatched once and has live values in the frame.
export async function rejectionAfterASuspension(n: number): Promise<number> {
  const first = await Promise.resolve(n);
  if (first > 0) {
    return await rejects(n);
  }
  return first;
}

// One rejecting element rejects the whole `all`, and the element that fulfils
// afterwards does not un-reject it.
export async function allWithARejection(n: number): Promise<number> {
  const values = await Promise.all([afterOneTick(n), rejects(n)]);
  return values[0]!;
}

// `race` forwards a rejection as readily as a value: first settlement of
// either kind wins, and this one is already rejected at subscription.
export async function raceWithARejection(n: number): Promise<number> {
  return await Promise.race([afterOneTick(n), rejects(n)]);
}
