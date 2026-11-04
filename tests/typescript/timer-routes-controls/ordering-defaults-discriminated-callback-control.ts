/*---
description: "Control for ordering-defaults-discriminated-callback: A discriminated number-or-string callback route crosses normalized delays and one-ms witnesses; narrowing retains the matching value and creation order."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-narrowing, ts-objects, ts-null-undefined]
flags: [async]
---*/
// Control: direct callbacks and explicit completion gates preserve this route and its jobs.
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, delay?: number): number { pending.push(callback); return 0; }
type Action = { kind: "number"; value: number; delay: number | undefined; run: (value: number) => void } | { kind: "string"; value: string; delay: number | undefined; run: (value: string) => void };
async function main(): Promise<void> {
  for (const offset of [0, 10]) {
    log.length = 0; pending.length = 0; const values: (number | string)[] = [];
    const numberSink = (value: number): void => { log.push("number:" + value); values.push(value); };
    const stringSink = (value: string): void => { log.push("string:" + value); values.push(value); };
    const inputs: Action[] = [
      { kind: "number", value: offset + 1, delay: 1, run: numberSink }, { kind: "string", value: "zero", delay: 0, run: stringSink },
      { kind: "number", value: offset - 1, delay: -3, run: numberSink }, { kind: "string", value: "nan", delay: NaN, run: stringSink },
      { kind: "number", value: offset, delay: undefined, run: numberSink }, { kind: "string", value: "one", delay: 1, run: stringSink }
    ];
    const done = new Promise<void>((resolve) => {
      let remaining = inputs.length;
      for (const route of inputs) {
        const callback = (): void => { if (route.kind === "number") route.run(route.value); else route.run(route.value); if (--remaining === 0) resolve(); };
        if (route.delay === undefined) enqueue(callback); else enqueue(callback, route.delay);
      }
      log.push("sync");
    });
    for (const callback of pending) callback();
    await done;
    assert.compareArray(log, ["sync", "number:" + (offset + 1), "string:zero", "number:" + (offset - 1), "string:nan", "number:" + offset, "string:one"]);
    assert.compareArray(values, [offset + 1, "zero", offset - 1, "nan", offset, "one"]);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
