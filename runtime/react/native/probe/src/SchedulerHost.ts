// A deterministic scheduler host: a logical clock, and posted work that
// runs only when the program drains it. The production scheduler runs over
// it unchanged, so the probe exercises real scheduling with reproducible
// output (node and the native build see the same clock).

let logicalTime = 0;

class PostedWork {
  readonly perform: () => void;
  constructor(perform: () => void) {
    this.perform = perform;
  }
}

class PendingTimer {
  readonly id: number;
  readonly at: number;
  readonly callback: () => void;
  cancelled = false;
  constructor(id: number, at: number, callback: () => void) {
    this.id = id;
    this.at = at;
    this.callback = callback;
  }
}

const posted: PostedWork[] = [];
const timers: PendingTimer[] = [];
let nextTimerId = 1;

export function now(): number {
  return logicalTime;
}

class BoundWork {
  perform: (() => void) | null = null;
}

const boundWork = new BoundWork();

export function bindPerformWork(perform: () => void): void {
  boundWork.perform = perform;
}

export function postWork(): void {
  const perform = boundWork.perform;
  if (perform !== null) {
    posted.push(new PostedWork(perform));
  }
}

export type Timer = number;

export function startTimer(callback: () => void, ms: number): Timer {
  const timer = new PendingTimer(nextTimerId++, logicalTime + ms, callback);
  timers.push(timer);
  return timer.id;
}

export function cancelTimer(id: Timer): void {
  for (const timer of timers) {
    if (timer.id === id) {
      timer.cancelled = true;
    }
  }
}

// Each slice of work costs one unit of logical time, so the scheduler's
// five-unit frames yield deterministically.
export function advanceTime(units: number): void {
  logicalTime += units;
}

// Runs posted work, then fires due timers, until nothing is left.
export function drainHost(): void {
  for (;;) {
    const work = posted.shift();
    if (work !== undefined) {
      logicalTime += 1;
      work.perform();
      continue;
    }
    let earliest: PendingTimer | null = null;
    for (const timer of timers) {
      if (!timer.cancelled && (earliest === null || timer.at < earliest.at)) {
        earliest = timer;
      }
    }
    if (earliest === null) {
      timers.length = 0;
      return;
    }
    earliest.cancelled = true;
    if (earliest.at > logicalTime) {
      logicalTime = earliest.at;
    }
    earliest.callback();
  }
}
