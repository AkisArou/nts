// Timers fire through the host and run inside the checkpoint: the microtasks
// a timer's callback queues run before the next timer's callback, as node runs
// them between timer callbacks. An interval clears itself from its callback.
let log = 0;
let ticks = 0;
let interval = 0;
function note(digit: number): void {
  log = log * 10 + digit;
}
function tick(): number {
  ticks = ticks + 1;
  return ticks;
}
function stop(): void {
  clearInterval(interval);
}

export function microtasksBetweenTimers(n: number): Promise<number> {
  log = 0;
  return new Promise<number>(resolve => {
    setTimeout(() => {
      note(1);
      Promise.resolve(n).then(() => note(2));
    }, 2);
    setTimeout(() => {
      note(3);
      resolve(log + n);
    }, 2);
  });
}

export function anIntervalStopsItself(n: number): Promise<number> {
  ticks = 0;
  return new Promise<number>(resolve => {
    interval = setInterval(() => {
      if (tick() === 3) {
        stop();
        resolve(ticks * 10 + n);
      }
    }, 1);
  });
}

export function aClearedTimerNeverFires(n: number): Promise<number> {
  log = 0;
  return new Promise<number>(resolve => {
    const cancelled = setTimeout(() => note(9), 1);
    clearTimeout(cancelled);
    setTimeout(() => resolve(log + n), 3);
  });
}
