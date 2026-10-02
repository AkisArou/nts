// `.then`, `.catch` and `.finally` on a promise: the reaction each one
// subscribes, and the promise it hands back.
//
// One closure per site, holding the source, the result and the handlers it was
// given, run as a microtask when the source settles -- the specification's
// `PerformPromiseThen` and `NewPromiseReactionJob`. Each export pins one way the
// reaction can be wrong without anything failing:
//
//   chained, twice            the handler's answer settles the result
//   adopted                   a handler returning a promise is adopted, not held
//   thrown                    a handler's `throw` rejects the result, and a later
//                             `.catch` sees it -- the raising entry
//   passedOver, caughtOver    an absent handler passes the settlement through,
//                             each way
//   finallyKeeps, finallyRejects, finallyThrows
//                             `finally` runs on both paths, keeps what settled
//                             unless it throws
//   strings, boxes            reference payloads in and out, which `--rc` counts
//   inALoop                   one site subscribed many times
//   interleaving, adoptionTicks
//                             the order node runs reactions in, and the two ticks
//                             adopting a promise costs
//   finallyTicks              `finally` settles its result two ticks after a
//                             `then` would, on both paths: the specification
//                             resolves it with a promise. The first version of
//                             the reaction passed the settlement through and was
//                             two ticks early; `interleaving` could not see it,
//                             because it watches when `onFinally` runs
//
// Transcribed from node (v24), not reasoned to: each export called with 0 and 3
// and its result printed. For n = 3:
//
//     adopted 8            adoptionTicks "a1,b1,a2,a3,b2"     boxes 6
//     caughtOver 9         chained 7        finallyKeeps 4     finallyRejects 103
//     finallyThrows "late" finallyTicks "t1,t2,then,t3,t4,finally,rejected,t5,t6"
//     inALoop 1228         interleaving "a1,b1,f,a2,b2"
//     passedOver 103       strings 5        thrown -1          twice 5
//
// What is deliberately not here: an unhandled rejection reaching the end of the
// program. That is whole-program behaviour the differential cannot drive, and
// the JVM runtime does not report one -- it is an `outcomes/` fixture instead.

export async function chained(n: number): Promise<number> {
  return await Promise.resolve(n).then((v) => v * 2).then((v) => v + 1);
}

// Both handlers given; only one runs.
export async function twice(n: number): Promise<number> {
  const fulfilled = await Promise.resolve(n).then(
    (v) => v + 1,
    () => -1,
  );
  const rejected = await Promise.reject(new Error("no")).then(
    () => -1,
    () => 1,
  );
  return fulfilled + rejected;
}

export async function adopted(n: number): Promise<number> {
  return await Promise.resolve(n).then((v) => Promise.resolve(v + 4)).then((v) => v + 1);
}

export async function thrown(n: number): Promise<number> {
  return await Promise.resolve(n)
    .then((v) => {
      if (v > 0) {
        throw new Error("too big");
      }
      return v;
    })
    .then((v) => v + 100)
    .catch(() => -1);
}

// A `.then` with no rejection handler passes the rejection on.
export async function passedOver(n: number): Promise<number> {
  return await Promise.reject<number>(new Error("passed"))
    .then((v) => v + 1)
    .catch(() => n + 100);
}

// A `.catch` passes a fulfilment on.
export async function caughtOver(n: number): Promise<number> {
  return await Promise.resolve(n)
    .catch(() => -1)
    .then((v) => v * 3);
}

export async function finallyKeeps(n: number): Promise<number> {
  let ran = 0;
  const kept = await Promise.resolve(n).finally(() => {
    ran = 1;
  });
  return kept + ran;
}

export async function finallyRejects(n: number): Promise<number> {
  let ran = 0;
  return await Promise.reject<number>(new Error("kept"))
    .finally(() => {
      ran = 100;
    })
    .catch(() => n + ran);
}

export async function finallyThrows(n: number): Promise<string> {
  return await Promise.resolve(n)
    .finally(() => {
      throw new Error("late");
    })
    .then(
      () => "kept",
      (e: unknown) => (e instanceof Error ? e.message : "other"),
    );
}

export async function strings(n: number): Promise<number> {
  const word = await Promise.resolve(String(n))
    .then((s) => s + "!")
    .then((s) => s + s);
  return word.length + (word.startsWith(String(n)) ? 1 : 0);
}

class Box {
  readonly value: number;
  constructor(value: number) {
    this.value = value;
  }
}

export async function boxes(n: number): Promise<number> {
  return await Promise.resolve(new Box(n))
    .then((box) => new Box(box.value * 2))
    .then((box) => box.value);
}

export async function inALoop(n: number): Promise<number> {
  let chain = Promise.resolve(n);
  for (let i = 0; i < 50; i++) {
    chain = chain.then((v) => v + i);
  }
  return await chain;
}

// Two chains off one promise, and a `finally` beside them: node runs reactions
// in subscription order, one microtask each.
export async function interleaving(n: number): Promise<string> {
  const log: string[] = [];
  const source = Promise.resolve(n);
  const a = source
    .then(() => {
      log.push("a1");
    })
    .then(() => {
      log.push("a2");
    });
  const b = source
    .then(() => {
      log.push("b1");
    })
    .then(() => {
      log.push("b2");
    });
  source.finally(() => log.push("f"));
  await a;
  await b;
  return log.join(",");
}

// A handler returning a promise settles its result two ticks later than one
// returning a value: `NewPromiseResolveThenableJob`, then the inner's reaction.
export async function adoptionTicks(n: number): Promise<string> {
  const log: string[] = [];
  const a = Promise.resolve(n)
    .then(() => {
      log.push("a1");
    })
    .then(() => {
      log.push("a2");
    })
    .then(() => {
      log.push("a3");
    });
  const b = Promise.resolve(n)
    .then(() => {
      log.push("b1");
      return Promise.resolve(0);
    })
    .then(() => {
      log.push("b2");
    });
  await a;
  await b;
  return log.join(",");
}

// A counting chain beside a `then`, a `finally` and a rejected `finally`: the
// tick each result settles on is where its label lands among the counts.
export async function finallyTicks(n: number): Promise<string> {
  const log: string[] = [];
  let counter: Promise<void> = Promise.resolve();
  for (let i = 1; i <= 6; i++) {
    counter = counter.then(() => {
      log.push("t" + String(i));
    });
  }
  const source = Promise.resolve(n);
  const a = source
    .then((v) => v)
    .then(() => {
      log.push("then");
    });
  const b = source
    .finally(() => {})
    .then(() => {
      log.push("finally");
    });
  const c = Promise.reject<number>(new Error("x"))
    .finally(() => {})
    .catch(() => {
      log.push("rejected");
    });
  await counter;
  await a;
  await b;
  await c;
  return log.join(",");
}
