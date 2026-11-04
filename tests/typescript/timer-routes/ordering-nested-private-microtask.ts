/*---
description: "A parent private callback queues a microtask that creates a child timer; Node runs that job before waiting callbacks and the child after both waiting timers."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-private-fields, ts-this]
flags: [async]
---*/
// A parent private callback queues a microtask that creates a child timer; Node runs that job before waiting callbacks and the child after both waiting timers.
const log: string[] = [];
class Scheduled {
  #callback: () => void;
  constructor(callback: () => void) { this.#callback = callback; }
  start(): void { setTimeout(this.#callback, 1); }
}
async function main(): Promise<void> {
  for (const offset of [0, 10]) {
    log.length = 0; const values: number[] = [], jobs: Promise<void>[] = [];
    const beforeWaiting = new Promise<void>((ready) => {
      jobs.push(new Promise<void>((resolve) => {
        let remaining = 4;
        const record = (label: string, value: number): void => { log.push(label); values.push(offset + value); if (--remaining === 0) resolve(); };
        new Scheduled(() => {
          record("parent", 1);
          queueMicrotask(() => { log.push("queue"); new Scheduled(() => { record("child", 4); }).start(); ready(); });
        }).start();
        new Scheduled(() => { record("waiting:a", 2); }).start();
        new Scheduled(() => { record("waiting:b", 3); }).start();
      }));
    });
    log.push("sync");
    await beforeWaiting;
    await Promise.all(jobs);
    assert.compareArray(log, ["sync", "parent", "queue", "waiting:a", "waiting:b", "child"]);
    assert.compareArray(values, [offset + 1, offset + 2, offset + 3, offset + 4]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
