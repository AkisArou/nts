/*---
description: "A parent timer narrows a number-or-string callback union before creating a child; Node runs the already-waiting timer before either selected child form."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-narrowing, ts-objects]
flags: [async]
---*/
// A parent timer narrows a number-or-string callback union before creating a child; Node runs the already-waiting timer before either selected child form.
const log: string[] = [];
type Action = { kind: "number"; value: number; run: (value: number) => void } | { kind: "string"; value: string; run: (value: string) => void };
async function main(): Promise<void> {
  for (const numeric of [true, false]) {
    log.length = 0; const values: (number | string)[] = [];
    const route: Action = numeric ? { kind: "number", value: 7, run: (value) => { log.push("number:" + value); values.push(value); } } : { kind: "string", value: "中", run: (value) => { log.push("string:" + value); values.push(value); } };
    const done = new Promise<void>((resolve) => {
      let remaining = 3;
      const complete = (): void => { if (--remaining === 0) resolve(); };
      const parent: () => void = () => {
        log.push("parent");
        if (route.kind === "number") setTimeout(() => { route.run(route.value); complete(); }, 1);
        else setTimeout(() => { route.run(route.value); complete(); }, 1);
        complete();
      };
      setTimeout(parent, 1);
      setTimeout(() => { log.push("waiting"); values.push("waiting"); complete(); }, 1);
      log.push("sync");
    });
    await done;
    assert.compareArray(log, ["sync", "parent", "waiting", numeric ? "number:7" : "string:中"]);
    assert.compareArray(values, ["waiting", numeric ? 7 : "中"]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
