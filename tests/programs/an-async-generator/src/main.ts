// `async function*`, and the `for await...of` that drives one.
//
// Both halves already existed and the combination did not: a synchronous
// generator compiled and an `async` function compiled, so neither suspension
// nor iteration was missing on its own. What had no lowering was one frame
// speaking both protocols.
//
// # What a step is
//
// A synchronous generator's step is one call that answers `done`, with the
// element left in the frame. An async generator cannot answer anything: by the
// time it reaches a `yield` it may have awaited twice and returned to the event
// loop twice, and there is no caller standing in front of it. So the consumer
// makes a promise, puts it in the frame, and awaits it:
//
//     p = nts_promise_new()        the promise for this step
//     frame.result = p             where the resumption will find it
//     retain frame                 it may be handed to the runtime
//     resume(frame)                runs until it yields, awaits, or ends
//     done = await p != 0          the suspension, in *this* frame
//
// That `await` is an ordinary one in the enclosing `async` function, so the
// waiting is done by machinery that already worked. `done` rides the promise as
// a number rather than on a `nts_promise_fulfill_bool` that would have to be
// added to three backends first.
//
// **The element still does not ride anything.** It is left in `yielded`, where
// a synchronous generator leaves it, so an async walk allocates one promise per
// step and no `{ value, done }` object ever.
//
// # The frame is still a generator
//
// `state` and `yielded` stay at 0 and 1 -- the prefix every frame shares with
// the abstract generator -- and `awaited` and `result` go after them. That is
// what lets an async generator arrive as a *parameter* and be walked through
// the same dispatch slot a synchronous one uses, which is the commonest
// spelling in the corpus: 33 `for await` sites in `runtime/node`, almost all
// over a value rather than over a call.

let log = 0;
function note(digit: number): void {
  log = log * 10 + digit;
}

function* syncCount(limit: number): Generator<number> {
  for (let i = 0; i < limit; i++) yield i;
}

/** Control: the synchronous walk, which this must not have changed. */
export function syncWalk(n: number): number {
  let total = 0;
  for (const v of syncCount(n & 3)) total += v;
  return total;
}

async function* ticks(limit: number): AsyncGenerator<number> {
  for (let i = 0; i < limit; i++) yield i;
}

/** Under test: the plain case, walked where it was made. */
export async function simple(n: number): Promise<number> {
  let total = 0;
  for await (const v of ticks(n & 3)) total += v;
  return total;
}

/**
 * Under test: an `await` *inside* the generator, which is the half that makes
 * this more than a generator with a longer name.
 *
 * Each step here suspends twice -- once on the awaited promise and once on the
 * step's own -- and the second resumption has to find the first's state.
 */
async function* awaiting(limit: number): AsyncGenerator<number> {
  for (let i = 0; i < limit; i++) {
    const got = await Promise.resolve(i * 2);
    yield got;
  }
}

export async function withAwaits(n: number): Promise<number> {
  let total = 0;
  for await (const v of awaiting(n & 3)) total += v;
  return total;
}

/**
 * Under test: arriving as a parameter, so nothing static says which body to
 * resume and the walk goes through the abstract generator's slot.
 *
 * This is the arm that found the layout bug. The abstract class carried only
 * the two-field prefix, so the step's promise was written at slot 3 of a
 * two-field layout -- `NTS2006 a field index outside its layout`, on the two
 * arms that dispatch and on neither of the arms that call directly.
 */
async function drain(g: AsyncGenerator<number>): Promise<number> {
  let total = 0;
  for await (const v of g) total += v;
  return total;
}

export async function throughAParameter(n: number): Promise<number> {
  return await drain(ticks(n & 3));
}

/** Under test: handed back by a function that is not one. */
function relay(limit: number): AsyncGenerator<number> {
  return ticks(limit);
}

export async function fromAReturn(n: number): Promise<number> {
  let total = 0;
  for await (const v of relay(n & 3)) total += v;
  return total;
}

/** Under test: no elements at all -- the loop must finish, not hang. */
export async function empty(n: number): Promise<number> {
  let total = 0;
  for await (const v of ticks(0)) total += v;
  return total + (n & 1);
}

/**
 * Under test: two walks of two frames of one async generator.
 *
 * A frame is per-call, so these must not share state. One frame reused would
 * answer the first sum and then zero.
 */
export async function twoFrames(n: number): Promise<number> {
  const first = await drain(ticks(n & 3));
  const second = await drain(ticks(n & 3));
  return first * 100 + second;
}

/** Under test: leaving the walk early, which stops asking for steps. */
export async function broken(n: number): Promise<number> {
  let total = 0;
  for await (const v of ticks(8)) {
    if (v > (n & 3)) break;
    total += v;
  }
  return total;
}

/** Suspends once, then writes a 9 from the microtask queue. */
async function otherWork(): Promise<number> {
  await Promise.resolve(0);
  note(9);
  return 0;
}

/**
 * Under test: that a step really does suspend, recorded as an **order**.
 *
 * Every arm above would give the same sum if the loop ran straight through
 * without awaiting anything, so none of them can tell a real suspension from a
 * synchronous walk wearing the syntax. This one can: `otherWork` is queued
 * before the loop starts and writes a 9, and where that 9 lands says whether
 * the loop gave the queue a turn.
 *
 * It is the same shape that caught `for await` over a *synchronous* sequence
 * disagreeing with node -- `129` here against node's `912` -- which is refused
 * by name and recorded in `blockers/a-for-await-over-a-synchronous-sequence`.
 */
async function* twoElements(): AsyncGenerator<number> {
  yield 1;
  yield 2;
}

export async function stepOrder(n: number): Promise<number> {
  log = 0;
  const held = otherWork();
  for await (const v of twoElements()) note(v);
  await held;
  return log + (n & 0);
}
