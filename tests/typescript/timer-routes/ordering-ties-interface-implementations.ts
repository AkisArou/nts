/*---
description: "Two implementations of a typed scheduler interface preserve equal-delay callback order through an instance delay field and a direct implementation."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-interfaces, ts-class, ts-class-fields, ts-this]
flags: [async]
---*/
// Two implementations of a typed scheduler interface preserve equal-delay callback order through an instance delay field and a direct implementation.
const log: string[] = [];
interface TimerOrderingScheduler { start(callback: () => void): void; }
class FieldScheduler implements TimerOrderingScheduler {
  delay: number = 1;
  start(callback: () => void): void { setTimeout(callback, this.delay); }
}
class DirectScheduler implements TimerOrderingScheduler { start(callback: () => void): void { setTimeout(callback, 1); } }
async function main(): Promise<void> {
  const routes: TimerOrderingScheduler[] = [new FieldScheduler(), new DirectScheduler()];
  for (const route of routes) {
    log.length = 0; const values: number[] = [];
    const done = new Promise<void>((resolve) => {
      let remaining = 3;
      for (const value of [8, 0, -3]) route.start(() => { log.push("timer:" + value); values.push(value); if (--remaining === 0) resolve(); });
      log.push("sync");
    });
    await done;
    assert.compareArray(log, ["sync", "timer:8", "timer:0", "timer:-3"]);
    assert.compareArray(values, [8, 0, -3]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
