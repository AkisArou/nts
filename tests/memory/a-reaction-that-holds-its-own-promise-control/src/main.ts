// The control for `a-reaction-that-holds-its-own-promise`: the same two
// waiters, each holding the promise it waits on, but every promise settles.
//
// A suspended frame of `plusOne` holds its `awaited` promise, and a reaction
// closure captured its own promise, exactly as there. Here each promise is
// fulfilled, so its reaction runs and is dropped, which cuts the cycle, and
// counting alone frees everything. This differs from the fixture in that one
// thing, so the leak there is the never-settling promise's cycle and nothing
// else; it agrees with or without the cycle collector knowing that a promise
// leads to its reactions (`hir::cycles`).

let total = 0;
let seen = 0;

function settled(n: number): Promise<number> {
  return new Promise<number>((resolve) => {
    resolve(n);
  });
}

async function plusOne(p: Promise<number>): Promise<void> {
  total = total + (await p) + 1;
}

/** A read of the promise no fold removes, so the closure must capture it. */
function looked(p: Promise<number>): number {
  seen = seen + 1;
  return p === null ? 0 : 1;
}

export function work(n: number): number {
  const waiting = settled(n + 1);
  plusOne(waiting);
  const done = settled(n);
  plusOne(done);
  const held = settled(n + 2);
  held.then((value) => {
    total = total + value + looked(held);
  });
  const kept = settled(n);
  kept.then((value) => {
    total = total + value + looked(kept);
  });
  return n;
}
