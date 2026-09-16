// `Promise.withResolvers()`, the deferred pattern.
//
// `examples/promise-constructor` refuses `new Promise(r => { saved = r })` --
// a `resolve` used as a value rather than called -- and says it needs a real
// closure over the promise. This is the same pattern with a standard spelling,
// and it needs no closure either, for a reason that is about the *type* rather
// than about the syntax.
//
// `PromiseWithResolvers<T>` is `{ promise, resolve, reject }` and holds nothing
// besides the promise: `resolve` and `reject` are the two settles the runtime
// already performs, with the promise as the receiver, and `promise` is the
// promise. So the capability is **represented as** `Promise<T>` -- no layout,
// no allocation, no capture -- and the three members are reached through the
// object rather than extracted from it.
//
// That is why it works where the executor form does not. `new Promise(f)` gets
// its escape from inlining `f`, which is a fact about where the callback was
// written; this one is a fact about what the value contains, so it survives
// being stored in a field, reassigned, and passed to another function.
//
// What is still refused, at the bottom of this file's story: `const r =
// d.resolve`. That extracts the member as a value, which is the closure the
// representation does not have.

// The documented spelling, and what `runtime/node/timers/src/promises.ts`
// writes. `resolve` binds no value here -- it binds a *meaning* for calls to
// that name, which is exactly what a `new Promise` executor's parameter binds.
export async function destructured(n: number): Promise<number> {
  const { promise, resolve } = Promise.withResolvers<number>();
  resolve(n + 1);
  return await promise;
}

// Renamed, because a destructuring may. The settle follows the new name.
export async function renamed(n: number): Promise<number> {
  const { promise: eventual, resolve: settle } = Promise.withResolvers<number>();
  settle(n * 2);
  return await eventual;
}

// Kept whole, which is how most of `runtime/node` uses it.
//
// **Not "all of them", and the difference is this example's whole history.**
// `docs/records/0337` built this representation, wrote "of the 25 sites, every
// member use is a call" after checking two files of eleven, and reverted an hour
// later: `broadcast.ts` stores `pending.resolve` in a field, five distinct sites
// do, and they refuse. An example written by the author of a change cannot find
// that -- it tests the change against the model that produced it. `addons.sh`
// over the 24 node modules is what does, and it is what landed this.
export async function held(n: number): Promise<number> {
  const pending = Promise.withResolvers<number>();
  pending.resolve(n + 10);
  return await pending.promise;
}

// Reassigned, as in `fs/src/promises.ts` and `stream/src/duplexify.ts`. The
// name holds a different promise each time, which is what a representation
// carrying no compile-time binding buys.
export async function reassigned(n: number): Promise<number> {
  let waiter = Promise.withResolvers<number>();
  waiter.resolve(n);
  const first = await waiter.promise;
  waiter = Promise.withResolvers<number>();
  waiter.resolve(n * 3);
  return first + (await waiter.promise);
}

// Rejected and caught. The reason is a reference, as `Promise.reject` requires.
export async function rejected(n: number): Promise<number> {
  const capability = Promise.withResolvers<number>();
  capability.reject(new Error("refused"));
  try {
    return await capability.promise;
  } catch {
    return n - 1;
  }
}

// Held in a private field and settled from a different method -- the shape
// `stream/src/iter/*.ts` uses for backpressure, and the one a closure would
// have been needed for.
class Gate {
  #capability: PromiseWithResolvers<number> | undefined = undefined;

  block(): Promise<number> {
    const made = Promise.withResolvers<number>();
    this.#capability = made;
    return made.promise;
  }

  release(value: number): boolean {
    const held = this.#capability;
    if (held === undefined) {
      return false;
    }
    held.resolve(value);
    this.#capability = undefined;
    return true;
  }
}

export async function gated(n: number): Promise<number> {
  const gate = new Gate();
  const waiting = gate.block();
  const released = gate.release(n + 4);
  const seen = await waiting;
  return released ? seen : -1;
}

// The ordering, which is the half a returned value alone does not check.
// `consume` suspends at the `await` and resumes only after `resolve`, so node
// answers `1,2,4,3` rather than `1,3,2,4`: the resumption is a later turn, not
// part of the call to `resolve`. A capability also crosses a function boundary
// here as an ordinary parameter.
async function consume(gate: PromiseWithResolvers<number>, log: number[]): Promise<void> {
  log.push(1);
  const seen = await gate.promise;
  log.push(seen);
}

export async function ordering(n: number): Promise<string> {
  const log: number[] = [];
  const gate = Promise.withResolvers<number>();
  const running = consume(gate, log);
  log.push(2);
  gate.resolve(n);
  log.push(4);
  await running;
  return log.join(",");
}
