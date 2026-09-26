// `await x`, where x is not a promise but has a `then` method: a thenable.
//
// The specification resolves it through `x.then(resolve, reject)`, called in a
// job of its own (NewPromiseResolveThenableJob) -- so `await x` answers what
// `then` hands its first callback, or throws what it hands its second, and it
// takes the ticks that job and the resolve take. Node does exactly that.
//
// The same resolution runs wherever a promise is resolved with a value, not
// only at `await`: `return x` from an async function, and `resolve(x)` inside a
// `new Promise` executor. Each export is one of those paths; `ordering` makes
// the extra ticks observable; `plain` and `aPromise` are the controls -- an
// object with no `then`, which resolves to itself, and a real promise, which
// is adopted as before.
//
// Transcribed from node (v24), not reasoned to: each export called with 0 and
// 3 and its result printed, by
//
//     const m = await import("./src/main.ts");
//     for (const name of Object.keys(m).sort())
//       for (const n of [0, 3])
//         try { console.log(name, n, JSON.stringify(await m[name](n))); }
//         catch (e) { console.log(name, n, "threw", e.message); }
//
// run as `node --experimental-strip-types`. For n = 3:
//
//     aPromise 6        asItsBase 103     firstCallWins 3   late 31
//     lockedInByAThenable 30                  nested 7
//     ordering "a1,before,a2,a3,thenable 4,a4"
//     plain 3           rejects "refused 3"       resolvedWith 4
//     resolves 4        returned 4        throwsInThen "then threw 3"
//
// `ordering` is the one to read: awaiting a thenable resumes after `a3`,
// three turns out, where awaiting a promise resumes after `a2`. The resolve
// job and the `then` callback's resolve are each a turn; a lowering that
// called `then` inline would print `thenable` after `a2` and agree with every
// other export. (`steps` awaits `0` rather than `null`, which is the same turn
// and which this compiler refuses for a reason of its own.)
//
// # How it is built
//
// `settle` is the one resolve procedure every path above reaches. The census
// in `thenables` finds each class that declares a `then` method, and makes it
// a job -- a closure calling `then` -- and the pair of resolving functions it
// hands `then`, typed exactly as `then`'s parameters are. A resolve site whose
// value can be an instance of one tests for it and queues the job;
// `nts_promise_claim` is the pair's `alreadyResolved`.
//
// # Two arms refuse, by name, and are listed in `example-refusals`
//
// `throwsInThen`: a throw from `then` must reject the promise, so the job has
// to catch it, and a method has no raising copy to catch it through. Refused
// at the resolve site rather than ending the program where node rejects.
//
// `asItsBase`: the checker types `await held` from `held: Base`, which has no
// `then`, so the promise is typed to settle with a `Base` -- and `Derived`'s
// `then` delivers a number, which a `Base` slot cannot hold. Node answers 103;
// this says why it cannot.

class Box {
  readonly value: number;
  constructor(value: number) {
    this.value = value;
  }
  then(onFulfilled: (value: number) => unknown): void {
    onFulfilled(this.value + 1);
  }
}

class Refusal {
  readonly reason: string;
  constructor(reason: string) {
    this.reason = reason;
  }
  then(_onFulfilled: (value: number) => unknown, onRejected: (reason: unknown) => unknown): void {
    onRejected(new Error(this.reason));
  }
}

/** Throws from `then` itself, before calling either callback. */
class Thrower {
  then(_onFulfilled: (value: number) => unknown): void {
    throw new Error("then threw");
  }
}

/** Calls back later, from a continuation of its own. */
class Later {
  readonly value: number;
  constructor(value: number) {
    this.value = value;
  }
  then(onFulfilled: (value: number) => unknown): void {
    const deliver = async (): Promise<void> => {
      await 0;
      onFulfilled(this.value * 10);
    };
    void deliver();
  }
}

/** Calls back more than once, and both ways: only the first call counts. */
class Fickle {
  readonly value: number;
  constructor(value: number) {
    this.value = value;
  }
  then(onFulfilled: (value: number) => unknown, onRejected: (reason: unknown) => unknown): void {
    onFulfilled(this.value);
    onFulfilled(this.value + 1);
    onRejected(new Error("late"));
  }
}

/** Delivers another thenable, which is resolved in its turn. */
class Nested {
  readonly value: number;
  constructor(value: number) {
    this.value = value;
  }
  then(onFulfilled: (value: Box) => unknown): void {
    onFulfilled(new Box(this.value * 2));
  }
}

/**
 * Resolves with a slow thenable, then a fast one. The first call locks the
 * promise in while it is still pending, so the fast one is ignored -- which is
 * the resolving pair's `alreadyResolved`, and the one arm here the runtime's
 * refusal to settle twice cannot answer for it.
 */
class Locking {
  readonly value: number;
  constructor(value: number) {
    this.value = value;
  }
  then(onFulfilled: (value: Later | Box) => unknown): void {
    onFulfilled(new Later(this.value));
    onFulfilled(new Box(0));
  }
}

/** A thenable held as its base type: the base has no `then`, the object does. */
class Base {
  readonly value: number;
  constructor(value: number) {
    this.value = value;
  }
}
class Derived extends Base {
  then(onFulfilled: (value: number) => unknown): void {
    onFulfilled(this.value + 100);
  }
}

export async function resolves(n: number): Promise<number> {
  const v = await new Box(n);
  return v;
}

export async function rejects(n: number): Promise<string> {
  try {
    await new Refusal("refused " + n.toString());
    return "not refused";
  } catch (error) {
    return (error as Error).message;
  }
}

export async function throwsInThen(n: number): Promise<string> {
  try {
    await new Thrower();
    return "did not throw";
  } catch (error) {
    return (error as Error).message + " " + n.toString();
  }
}

export async function late(n: number): Promise<number> {
  return (await new Later(n)) + 1;
}

async function returning(n: number): Promise<number> {
  return new Box(n);
}

/** `return x` from an async function resolves through `then` as well. */
export async function returned(n: number): Promise<number> {
  return await returning(n);
}

/** `resolve(x)` inside an executor resolves through `then` as well. */
export async function resolvedWith(n: number): Promise<number> {
  return await new Promise<number>((resolve) => {
    resolve(new Box(n) as unknown as PromiseLike<number>);
  });
}

export async function asItsBase(n: number): Promise<number> {
  const held: Base = new Derived(n);
  const v = await held;
  return v instanceof Base ? -1 : (v as unknown as number);
}

async function steps(log: string[]): Promise<void> {
  log.push("a1");
  await 0;
  log.push("a2");
  await 0;
  log.push("a3");
  await 0;
  log.push("a4");
}

/** The resolve job's ticks are observable, and this is where. */
export async function ordering(n: number): Promise<string> {
  const log: string[] = [];
  const box = new Box(n);
  const p = steps(log);
  log.push("before");
  const v = await box;
  log.push("thenable " + v.toString());
  await p;
  return log.join(",");
}

/** The resolving functions are one pair with one flag: the first call wins. */
export async function firstCallWins(n: number): Promise<number> {
  return await new Fickle(n);
}

/** A pending resolution holds the pair, as a settled one does. */
export async function lockedInByAThenable(n: number): Promise<number> {
  return await new Locking(n);
}

/** A thenable that delivers a thenable: resolved twice over, as node does. */
export async function nested(n: number): Promise<number> {
  return await new Nested(n);
}

/** Control: an object with no `then` resolves to itself. */
export async function plain(n: number): Promise<number> {
  const v = await { value: n };
  return v.value;
}

/** Control: a real promise is adopted as before. */
export async function aPromise(n: number): Promise<number> {
  return (await Promise.resolve(n)) * 2;
}
