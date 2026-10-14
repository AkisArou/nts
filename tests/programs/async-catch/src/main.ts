// `try { await p } catch { … }`.
//
// A rejected `await` inside a `try` has to reach that `try`'s handler, and it
// did not: a resumption's rejection went to one shared exit that rejects this
// function's own promise, because until `try`/`catch` existed that was the
// whole of what a rejection could do.
//
// That was a **wrong answer** rather than a gap —
// `try { await failing() } catch { return -99 }` compiled, ran, and rejected
// where node returns -99 — so it was refused by name. 89 occurrences across 17
// sites in `runtime/node`, and `try { await reader.close() } catch {}` is the
// shape: teardown that must not turn a data error into a close error.
//
// The fix is that a rejection is an *edge into the handler* like a `throw`, and
// the block it leaves does not exist when the lowering runs — `suspend` creates
// it when it splits the function at the `await`. So the handler and the
// arguments are settled at the lowering, into the operation, and read there.

async function failing(n: number): Promise<number> {
  if (n > 0) {
    throw new Error("no");
  }
  return n + 1;
}

export async function caught(n: number): Promise<number> {
  try {
    const v = await failing(n);
    return v * 10;
  } catch {
    return -99;
  }
}

// The reason is bound and read. `catch (e)` is `unknown`, so the reason is
// erased — which is why the runtime helper for it did not exist until now:
// while a rejection could only be *forwarded*, it never had to be named.
export async function boundReason(n: number): Promise<number> {
  try {
    const v = await failing(n);
    return v;
  } catch (e) {
    return e instanceof Error ? -1 : -2;
  }
}

// A `throw` and an `await` reaching one handler, with a local they disagree
// about. The handler's parameters have to cover both edges: computed from the
// throws alone, the rejection path read `mark` at whatever the last `throw`
// left it.
export async function bothEdges(n: number): Promise<number> {
  let mark = 1;
  try {
    if (n > 5) {
      mark = 2;
      throw new Error("direct");
    }
    mark = 3;
    const v = await failing(n);
    mark = 4;
    return v + mark;
  } catch {
    return -mark;
  }
}

// Two awaits in one `try`, so two rejection edges land on one handler and the
// second must not be given the first's arguments.
export async function twoAwaits(n: number): Promise<number> {
  try {
    const a = await failing(n - 10);
    const b = await failing(n);
    return a + b;
  } catch {
    return -7;
  }
}

// Nested: the inner handler catches and the outer never runs.
export async function nested(n: number): Promise<number> {
  try {
    try {
      const v = await failing(n);
      return v;
    } catch {
      return -3;
    }
  } catch {
    return -4;
  }
}

// A `catch` that throws on, so the rejection reaches the *outer* handler
// through an ordinary `throw` edge after arriving through a rejection one.
export async function rethrown(n: number): Promise<number> {
  try {
    try {
      const v = await failing(n);
      return v;
    } catch {
      throw new Error("again");
    }
  } catch {
    return -5;
  }
}

// An `await` inside the `catch` itself, which belongs to whatever encloses the
// `try` rather than to the handler it is in.
export async function awaitInsideTheHandler(n: number): Promise<number> {
  try {
    try {
      const v = await failing(n);
      return v;
    } catch {
      const fallback = await failing(-1);
      return fallback * 100;
    }
  } catch {
    return -6;
  }
}
