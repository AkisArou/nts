// `async function f() { return g(); }` — adoption.
//
// The outer promise does not take the inner *promise* as its payload. It takes
// the inner's eventual settlement, and it takes it **two microtasks later**.
// Both halves are observable, which is why this is a runtime operation
// (`nts_promise_adopt`, in all three runtimes) rather than a copy at the settle
// site. Before it existed the shape was refused — and before *that* it was a
// clang diagnostic against generated code, because an `NtsPromise *` does not
// go where a `double` is wanted.
//
// # The two hops are the specification's two jobs
//
// Resolving a promise with a thenable enqueues `NewPromiseResolveThenableJob`;
// that job subscribes, and the subscription's reaction settles. So a `return
// g()` whose `g()` has already settled lands exactly one tick after a
// `return await g()` would.
//
// **That is what `whichFirst` measures, and it is the arm that could fail.**
// One hop instead of two makes both land on the same tick, and the answer flips
// from 21 to 12 — registration order rather than tick order. Every other arm
// here agrees under either count, which is exactly why this one has to exist.

async function settled(n: number): Promise<number> {
  return n;
}

async function viaAdoption(n: number): Promise<number> {
  return settled(n);
}

async function viaAwait(n: number): Promise<number> {
  return await settled(n);
}

async function record(log: number[], id: number, p: Promise<number>): Promise<void> {
  await p;
  log.push(id);
}

/** The value crosses. The plainest arm, and it holds under any tick count. */
export async function adopts(n: number): Promise<number> {
  return await viaAdoption(n);
}

/** Two levels of adoption, so a fix that only handled one would show. */
export async function twice(n: number): Promise<number> {
  const once = async (): Promise<number> => viaAdoption(n);
  const then = async (): Promise<number> => once();
  return await then();
}

/** **The ordering arm.** Started first, lands second, because adoption costs a
 *  tick that `await` does not. node answers 21; one hop would answer 12. */
export async function whichFirst(n: number): Promise<number> {
  const log: number[] = [];
  const first = record(log, 1, viaAdoption(n));
  const second = record(log, 2, viaAwait(n));
  await first;
  await second;
  return log[0] * 10 + log[1];
}

/** Two adoptions against each other: both cost the same, so registration order
 *  decides and the answer is 12. A tick miscounted on only one path would not
 *  show here, which is why it is the companion to the arm above rather than a
 *  replacement for it. */
export async function twoAdoptions(n: number): Promise<number> {
  const log: number[] = [];
  const first = record(log, 1, viaAdoption(n));
  const second = record(log, 2, viaAdoption(n + 1));
  await first;
  await second;
  return log[0] * 10 + log[1];
}

/** A rejection crossing the adoption, which takes the other arm of the forward. */
export async function rejects(n: number): Promise<number> {
  const failing = async (): Promise<number> => {
    throw new Error("inner");
  };
  const adopting = async (): Promise<number> => failing();
  try {
    return await adopting();
  } catch {
    return n + 100;
  }
}

/** The inner is still **pending** when it is adopted, so the subscription is
 *  stored rather than answered by the already-settled path. */
export async function pending(n: number): Promise<number> {
  const slow = async (): Promise<number> => {
    await settled(0);
    await settled(0);
    return n * 3;
  };
  const adopting = async (): Promise<number> => slow();
  return await adopting();
}
