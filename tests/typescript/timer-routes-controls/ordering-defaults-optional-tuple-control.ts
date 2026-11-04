/*---
description: "Control for ordering-defaults-optional-tuple: Optional delay tuples cross omitted, zero, negative, NaN and one in both creation orders; Node treats every entry as a one-ms tie."
features: [ts-timer-routes, ts-timer-route-ordering, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-unknown, ts-tuples, ts-tuple-optional]
flags: [async]
---*/
// Control: direct callbacks and explicit completion gates preserve this route and its jobs.
const log: string[] = [];
const pending: (() => void)[] = [];
function enqueue(callback: () => void, delay?: number): number { pending.push(callback); return 0; }
async function main(): Promise<void> {
  for (const reverse of [false, true]) {
    log.length = 0; pending.length = 0; const values: string[] = [];
    const inputs: [string, number?][] = [["one-a", 1], ["zero", 0], ["negative", -7], ["nan", NaN], ["omitted"], ["one-b", 1]];
    if (reverse) inputs.reverse();
    const done = new Promise<void>((resolve) => {
      let remaining = inputs.length;
      for (const input of inputs) {
        const callback = (): void => { log.push(input[0]); values.push(input[0]); if (--remaining === 0) resolve(); };
        if (input.length === 1) enqueue(callback); else enqueue(callback, input[1]);
      }
      log.push("sync");
    });
    for (const callback of pending) callback();
    await done;
    const expected = reverse ? ["one-b", "omitted", "nan", "negative", "zero", "one-a"] : ["one-a", "zero", "negative", "nan", "omitted", "one-b"];
    assert.compareArray(log, ["sync", ...expected]);
    assert.compareArray(values, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
