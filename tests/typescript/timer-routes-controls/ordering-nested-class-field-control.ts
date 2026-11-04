/*---
description: "Control for ordering-nested-class-field: An instance callback creates another field-held timer at the same delay; Node runs both already-waiting callbacks before the nested callback."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-this]
flags: [async]
---*/
// Control: direct callbacks and explicit completion gates preserve this route and its jobs.
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, delay?: number): number { pending.push(callback); return 0; }
class Scheduled { callback: () => void; constructor(callback: () => void) { this.callback = callback; } }
async function main(): Promise<void> {
  for (const delay of [1, 4]) {
    log.length = 0; pending.length = 0; const values: number[] = [];
    const done = new Promise<void>((resolve) => {
      let remaining = 4;
      const record = (label: string, value: number): void => { log.push(label); values.push(value); if (--remaining === 0) resolve(); };
      const child = new Scheduled(() => { record("child", delay + 3); });
      const parent = new Scheduled(() => { record("parent", delay); enqueue(child.callback, delay); });
      const first = new Scheduled(() => { record("waiting:a", delay + 1); });
      const second = new Scheduled(() => { record("waiting:b", delay + 2); });
      enqueue(parent.callback, delay); enqueue(first.callback, delay); enqueue(second.callback, delay);
      log.push("sync");
    });
    for (const callback of pending) callback();
    await done;
    assert.compareArray(log, ["sync", "parent", "waiting:a", "waiting:b", "child"]);
    assert.compareArray(values, [delay, delay + 1, delay + 2, delay + 3]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
