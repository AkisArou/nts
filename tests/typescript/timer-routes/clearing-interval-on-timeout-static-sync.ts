/*---
description: "Synchronous clearInterval cancels a timeout stored in a static field."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-class, ts-class-fields, ts-this, ts-null-undefined, ts-unions, ts-static]
flags: [async]
---*/
// A static field carries a timeout handle into clearInterval; node omits the target and preserves the unrelated survivor through the final sentinel.
const log: string[] = [];
class Slot { static handle: number | undefined; static cancel(): void { log.push("clear-interval"); clearInterval(this.handle); } }
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const delay of [1, 4]) {
    log.length = 0; const seen: number[] = [];
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    const target = (): void => { log.push("target:" + value); seen.push(value); };
    const survivor = (): void => { log.push("survivor:" + value); seen.push(value * 10); };
    Slot.handle = setTimeout(target, delay); setTimeout(survivor, delay); Slot.cancel(); setTimeout(sentinel, delay); log.push("sync");
    await done; log.push("after");
    assert.compareArray(log, ["clear-interval", "sync", "survivor:" + value, "sentinel", "after"]);
    assert.compareArray(seen, [value * 10]); assert.sameValue(seen.length, 1);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
