// `await f(x)`, where `f` is an `async` function that settles inside the call.
//
// Such an `f` can neither suspend nor reject, and fulfils with a value that is
// never a thenable, so its promise is settled before the caller sees it and an
// `await` of it resumes exactly one microtask later. The compiler calls a
// variant of `f` that answers the value, keeps it in the awaiting frame and
// queues the resumption itself (`compiler/core/src/hir/settled.rs`) -- no
// promise at all. Each export below interleaves that with another chain, whose
// ticks the log records, so the one microtask is checked rather than assumed;
// and each has a control that differs from it in one thing and keeps the
// promise: a callee that suspends once, one that throws, one that adopts
// another promise, a promise awaited twice.

async function settled(x: number): Promise<number> {
  return x * 2 + 1;
}

/** Control: the same value, after one suspension of its own. */
async function suspending(x: number): Promise<number> {
  await Promise.resolve(0);
  return x * 2 + 1;
}

/** Control: rejects for some inputs, so its promise can be rejected. */
async function throwing(x: number): Promise<number> {
  if (x > 2) {
    throw new Error("big " + x.toString());
  }
  return x * 2 + 1;
}

/** Control: fulfils by adopting another promise, which takes two ticks more. */
async function adopting(x: number): Promise<number> {
  return settled(x);
}

async function noted(log: string[], x: number): Promise<void> {
  log.push("v" + x.toString());
}

async function named(x: number): Promise<string> {
  return x > 1 ? "big" : "small";
}

async function flagged(x: number): Promise<boolean> {
  return x > 1;
}

/** The other chain: one log entry a tick. */
async function ticks(log: string[], count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    log.push("t" + i.toString());
    await Promise.resolve(i);
  }
}

export async function settledOrdering(n: number): Promise<string> {
  const log: string[] = [];
  const other = ticks(log, 8);
  for (let i = 0; i < 3; i++) {
    log.push("a" + (await settled(n + i)).toString());
  }
  await other;
  return log.join(",");
}

export async function suspendingOrdering(n: number): Promise<string> {
  const log: string[] = [];
  const other = ticks(log, 8);
  for (let i = 0; i < 3; i++) {
    log.push("a" + (await suspending(n + i)).toString());
  }
  await other;
  return log.join(",");
}

export async function throwingOrdering(n: number): Promise<string> {
  const log: string[] = [];
  const other = ticks(log, 8);
  for (let i = 0; i < 3; i++) {
    try {
      log.push("a" + (await throwing(n + i)).toString());
    } catch (e) {
      log.push("caught");
    }
  }
  await other;
  return log.join(",");
}

/** The settled call inside a `try`: its rejection edge is never taken. */
export async function settledInATry(n: number): Promise<string> {
  const log: string[] = [];
  const other = ticks(log, 8);
  for (let i = 0; i < 3; i++) {
    try {
      log.push("a" + (await settled(n + i)).toString());
    } catch (e) {
      log.push("caught");
    }
  }
  await other;
  return log.join(",");
}

export async function adoptingOrdering(n: number): Promise<string> {
  const log: string[] = [];
  const other = ticks(log, 10);
  for (let i = 0; i < 3; i++) {
    log.push("a" + (await adopting(n + i)).toString());
  }
  await other;
  return log.join(",");
}

/** Control: the promise is held and awaited twice, so it stays a promise. */
export async function awaitedTwice(n: number): Promise<string> {
  const log: string[] = [];
  const other = ticks(log, 6);
  const held = settled(n);
  log.push("made");
  log.push("a" + (await held).toString());
  log.push("b" + (await held).toString());
  await other;
  return log.join(",");
}

/** The other payloads that are never thenables: nothing, a string, a flag. */
export async function otherPayloads(n: number): Promise<string> {
  const log: string[] = [];
  const other = ticks(log, 8);
  await noted(log, n);
  const name = await named(n);
  log.push(name);
  const flag = await flagged(n);
  log.push(flag ? "yes" : "no");
  await other;
  return log.join(",");
}

/**
 * A promise first, then values in hand: the frame keeps the promise in its
 * `awaited` slot after the first `await`, and gives it back at the next one,
 * which waits on none.
 */
export async function promiseThenSettled(n: number): Promise<string> {
  const log: string[] = [];
  const other = ticks(log, 6);
  log.push("p" + (await Promise.resolve(n)).toString());
  log.push("a" + (await settled(n)).toString());
  log.push("b" + (await settled(n + 1)).toString());
  await other;
  return log.join(",");
}

/** Across a loop, so the frame carries the sum through every suspension. */
export async function summed(n: number): Promise<number> {
  let sum = 0;
  for (let i = 0; i < 100; i++) {
    sum += await settled(i + n);
  }
  return sum;
}
