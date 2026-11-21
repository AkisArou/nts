// Loop turns and timer bookkeeping: `setImmediate` turns, each cancelling the
// timeouts the turn before armed and arming its own -- the shape of a
// server's request timeouts, which are armed for every request and almost
// never fire.
//
// One call is a fixed amount of it: 1,000 turns of the loop, 3,996 timeouts
// armed and the same number cancelled. Each timeout is 60 s out and none
// fires; one that did would add a million to the checksum, so a timer that
// should not have run is a wrong answer rather than a fast one.
//
// **Timers that fire after `setTimeout(f, 0)` are not measured, on purpose.**
// Node and Bun floor the delay at 1 ms, so a call that waits for its own
// zero-delay timer spends that millisecond idle in the loop whatever the work:
// one such timer per call took 1,205 us in node and 1,148 us in Bun, and ten
// thousand took 2,449 us, about half of it the wait (2026-11-21, E-cores).
// nts has no floor yet, and node's rule is decided for it
// (docs/language/async.md), so the floor would reach every column. A row
// timing it would time the clock.
//
// The call answers with a promise, so every column waits for the last turn
// before the call counts as done (tooling/bench's promised workload).

export function work(n: number): Promise<number> {
  return new Promise<number>((resolve) => {
    let armed: ReturnType<typeof setTimeout>[] = [];
    let turn = 0;
    let sum = 0;
    const fired = (): void => {
      sum += 1_000_000;
    };
    const next = (): void => {
      for (const timeout of armed) {
        clearTimeout(timeout);
      }
      armed = [];
      sum += turn * n + 1;
      turn++;
      if (turn === 1000) {
        resolve(sum);
        return;
      }
      for (let k = 0; k < 4; k++) {
        armed.push(setTimeout(fired, 60_000 + k));
      }
      setImmediate(next);
    };
    setImmediate(next);
  });
}

export const seed = 1;
