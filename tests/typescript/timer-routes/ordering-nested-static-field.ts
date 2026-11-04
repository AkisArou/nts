/*---
description: "A parent timer schedules a static callback then replaces the field; Node keeps that selected callback behind already-waiting same-delay timers."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-class, ts-class-fields, ts-static]
flags: [async]
---*/
// A parent timer schedules a static callback then replaces the field; Node keeps that selected callback behind already-waiting same-delay timers.
const log: string[] = [];
class Scheduled { static callback: () => void = () => { log.push("unused"); }; }
async function main(): Promise<void> {
  for (const value of ["x", "中"]) {
    log.length = 0; const values: string[] = [];
    const done = new Promise<void>((resolve) => {
      let remaining = 4;
      const record = (label: string): void => { log.push(label); values.push(value + label); if (--remaining === 0) resolve(); };
      Scheduled.callback = () => { record("child"); };
      const parent: () => void = () => {
        record("parent"); setTimeout(Scheduled.callback, 1);
        Scheduled.callback = () => { log.push("replacement"); };
      };
      setTimeout(parent, 1);
      setTimeout(() => { record("waiting:a"); }, 1); setTimeout(() => { record("waiting:b"); }, 1);
      log.push("sync");
    });
    await done;
    assert.compareArray(log, ["sync", "parent", "waiting:a", "waiting:b", "child"]);
    assert.compareArray(values, [value + "parent", value + "waiting:a", value + "waiting:b", value + "child"]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
