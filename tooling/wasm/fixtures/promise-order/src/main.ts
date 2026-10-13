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
