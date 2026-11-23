// Waiters that hold the promise they wait on, which never settles.
//
// Two shapes of one cycle through the runtime's own promise and reaction
// objects. A suspended frame: `pending` -> its reaction list -> the reaction
// -> the frame of `plusOne` -> its `awaited` slot -> `pending`. And a reaction
// closure that captured its promise: `pending` -> the posted reaction -> the
// closure -> `pending`. Once `work` returns, nothing outside either holds any
// of it, so only the collector can free them.
//
// Two things have to be right for it to. The compiler has to know that a
// promise can lead back to whatever holds it -- its reaction list holds the
// waiter -- so that a frame or closure holding one is a cycle candidate when
// it is released (`hir::cycles`); declared acyclic, neither was ever looked
// at and both cycles leaked whole. And the runtime has to trace the edges a
// promise and a reaction hold, the same ones their destruction gives up
// (`nts_promise_trace_fields`, `nts_reaction_trace_fields`). The leak check
// beside every count is what says whether both are.
//
// The waits on `settled` are the control: their reactions run and are dropped,
// which cuts the cycle, so counting alone frees them.

let total = 0;
let seen = 0;

function pending(): Promise<number> {
  return new Promise<number>((resolve) => {
    if (total < 0) {
      resolve(0);
    }
  });
}

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
  const waiting = pending();
  plusOne(waiting);
  const done = settled(n);
  plusOne(done);
  const held = pending();
  held.then((value) => {
    total = total + value + looked(held);
  });
  const kept = settled(n);
  kept.then((value) => {
    total = total + value + looked(kept);
  });
  return n;
}
