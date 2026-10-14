// The order promise reactions run in, observed through module state: a start
// export runs the synchronous part and returns; its return is the checkpoint,
// which drains every queued task; a read export then sees the order.
let log = 0;
function note(digit: number): void {
  log = log * 10 + digit;
}

export function read(n: number): number {
  return log + n * 0;
}

export function interleavedAwaits(n: number): number {
  log = 0;
  (async () => {
    note(1);
    await Promise.resolve(0);
    note(3);
    await Promise.resolve(0);
    note(5);
  })();
  (async () => {
    note(2);
    await Promise.resolve(0);
    note(4);
  })();
  note(n > 0 ? 6 : 7);
  return log;
}

export function thenAfterAwait(n: number): number {
  log = 0;
  const p = Promise.resolve(n);
  p.then(() => note(2));
  (async () => {
    await p;
    note(3);
  })();
  note(1);
  return log;
}

export function anAsyncReturningAPromiseTakesTwoMoreTicks(n: number): number {
  log = 0;
  const inner = async (): Promise<number> => n;
  const outer = async (): Promise<number> => inner();
  outer().then(() => note(4));
  Promise.resolve(0)
    .then(() => note(1))
    .then(() => note(2))
    .then(() => note(3))
    .then(() => note(5));
  return log;
}

export function aRejectionCaught(n: number): number {
  log = 0;
  (async () => {
    try {
      await Promise.reject(n > 0 ? "positive" : "other");
    } catch (e) {
      note(typeof e === "string" ? 8 : 9);
    }
  })();
  note(1);
  return log;
}

async function later<T>(value: T): Promise<T> {
  await Promise.resolve(0);
  return value;
}

/** `Promise.all` answers in input order, whatever order its elements settle. */
export function allInInputOrder(n: number): number {
  log = 0;
  (async () => {
    const values = await Promise.all([later(1), Promise.resolve(n > 0 ? 2 : 3), later(4)]);
    for (const value of values) note(value);
  })();
  note(5);
  return log;
}

export function allOfStrings(n: number): number {
  log = 0;
  (async () => {
    const words = await Promise.all([later("ab"), Promise.resolve(n > 1 ? "cde" : "f")]);
    note(words.length);
    note(words[0]!.length + words[1]!.length);
  })();
  return log;
}

/** The first rejection rejects the whole, and a later fulfilment is ignored. */
export function allRejects(n: number): number {
  log = 0;
  (async () => {
    try {
      const parts: Promise<number>[] = [later(1), Promise.reject(n > 0 ? "no" : "never"), later(3)];
      await Promise.all(parts);
      note(1);
    } catch (e) {
      note(typeof e === "string" ? 7 : 8);
    }
  })();
  note(2);
  return log;
}

/** `Promise.all([])` is fulfilled with an empty array before it is returned. */
export function allOfNone(n: number): number {
  log = 0;
  const none: Promise<number>[] = [];
  (async () => {
    const values = await Promise.all(none);
    note(values.length + 1);
  })();
  note(n > 0 ? 2 : 3);
  return log;
}

/** `Promise.race` settles with the first settlement, a later one ignored. */
export function raceTakesTheFirst(n: number): number {
  log = 0;
  (async () => {
    const first = await Promise.race([later(1), n > 0 ? Promise.resolve(2) : later(3)]);
    note(first);
  })();
  note(4);
  return log;
}

export function raceRejects(n: number): number {
  log = 0;
  (async () => {
    try {
      const parts: Promise<number>[] = [later(n > 0 ? 1 : 2), Promise.reject(new Error("first"))];
      note(await Promise.race(parts));
    } catch {
      note(6);
    }
  })();
  return log;
}
