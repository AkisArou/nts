// `try { await p } finally { … }`.
//
// A rejected `await` leaves the `try` on a path **no `throw` wrote**, and the
// `finally` has to run on it. Node runs it; this compiler did not, which was a
// wrong answer rather than a gap and is why it was refused by name.
//
// Two shapes, and only one of them needed new machinery:
//
//   try { await p } catch { … } finally { … }
//     already worked once un-refused. The rejection reaches the handler, and
//     the handler's normal exit runs the `finally` — which is what
//     `run_finallys_to` does for every other way out of a `catch`.
//
//   try { await p } finally { … }
//     had nowhere to go. A handler is synthesised where the source wrote none:
//
//       try { … } finally { F }  ->  try { … } catch (e) { F; throw e } finally { F }
//
//     which is what explicit cleanup means. It is built only when a rejection
//     recorded itself, so a `try`/`finally` around code that cannot reject
//     leaves nothing behind — a block with no predecessors is one the verifier
//     rejects.

let ran = 0;

async function failing(n: number): Promise<number> {
  if (n > 0) {
    throw new Error("no");
  }
  return n + 1;
}

async function withCatch(n: number): Promise<number> {
  try {
    const v = await failing(n);
    return v * 10;
  } catch {
    return -99;
  } finally {
    ran = ran + 1;
  }
}

export async function caughtAndCleaned(n: number): Promise<number> {
  ran = 0;
  const answer = await withCatch(n);
  return answer * 1000 + ran;
}

// No `catch`: the rejection runs the `finally` and goes on rejecting, so the
// caller's handler sees it *after* the cleanup has happened.
async function cleanedOnly(n: number): Promise<number> {
  try {
    return await failing(n);
  } finally {
    ran = ran + 1;
  }
}

export async function cleanedThenRejected(n: number): Promise<number> {
  ran = 0;
  try {
    const v = await cleanedOnly(n);
    return v * 10 + ran;
  } catch {
    return -100 - ran;
  }
}

// The `finally` runs once, not twice: a `throw` in the body runs the copy
// `run_finallys_to` lowers on its way out and then jumps to the synthesised
// handler, which must not run it again.
export function onceNotTwice(n: number): number {
  let count = 0;
  try {
    try {
      if (n > 0) {
        throw new Error("no");
      }
      count = count + 100;
    } finally {
      count = count + 1;
    }
    return count;
  } catch {
    return -count;
  }
}

// Two awaits under one `finally`, and a local the paths disagree about.
async function twice(n: number): Promise<number> {
  let mark = 1;
  try {
    mark = 2;
    const a = await failing(n - 10);
    mark = 3;
    const b = await failing(n);
    return a + b + mark;
  } finally {
    ran = ran + mark;
  }
}

export async function twoAwaitsOneFinally(n: number): Promise<number> {
  ran = 0;
  try {
    const v = await twice(n);
    return v * 10 + ran;
  } catch {
    return -200 - ran;
  }
}

// A `try`/`finally` around code that can neither throw nor reject. Nothing
// needs a handler, and synthesising one anyway leaves a block with no
// predecessors — which the verifier rejects, so every defensive
// `try`/`finally` in the program would become an invalid function.
export function plainCleanup(n: number): number {
  let count = 0;
  try {
    count = count + n;
  } finally {
    count = count + 1;
  }
  return count;
}
