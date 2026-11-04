/*---
description: "Synchronous clearTimeout cancels an interval stored in an instance field before its first tick."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-class, ts-class-fields, ts-this, ts-null-undefined, ts-unions, ts-errors]
flags: [async]
---*/
// A field holds an interval handle passed to clearTimeout; node produces zero ticks before the later same-delay survivor and cleanup sentinel.
const log: string[] = [];
class Slot {
  handle: number | undefined;
  cancel(): void { log.push("clear-timeout"); clearTimeout(this.handle); }
  cleanup(): void { log.push("cleanup"); clearInterval(this.handle); }
}
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const delay of [1, 4]) {
    log.length = 0; const slot = new Slot(), seen: number[] = []; let ticks = 0, fault: unknown, finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); try { slot.cleanup(); } catch (error: unknown) { fault = error; log.push("caught"); } finish(); };
    const tick = (): void => { log.push("tick:" + value); seen.push(value); ticks++; };
    const survivor = (): void => { log.push("survivor:" + value); seen.push(value * 10); };
    slot.handle = setInterval(tick, delay); setTimeout(survivor, delay); slot.cancel(); setTimeout(sentinel, delay); log.push("sync");
    await done; log.push("after");
    assert.compareArray(log, ["clear-timeout", "sync", "survivor:" + value, "sentinel", "cleanup", "after"]);
    assert.compareArray(seen, [value * 10]); assert.sameValue(ticks, 0); assert.sameValue(fault, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
