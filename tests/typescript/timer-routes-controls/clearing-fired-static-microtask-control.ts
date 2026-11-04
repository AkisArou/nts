/*---
description: "A post-callback microtask can clear a completed static handle with either clear function. The control uses direct callbacks."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-class, ts-class-fields, ts-this, ts-null-undefined, ts-unions, ts-errors, ts-static]
flags: [async]
---*/
// The first timer queues a microtask that clears its completed static handle twice; node runs that microtask before the unaffected survivor. The control calls only the surviving callbacks.
const log: string[] = [];
class Slot { static handle: number | undefined; static cancel(): void { log.push("clear-fired"); { const cleared = this.handle; } { const cleared = this.handle; } } }
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const delay of [1, 4]) {
    log.length = 0; const seen: number[] = []; let fault: unknown;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    const fired = (): void => { log.push("fired:" + value); seen.push(value); queueMicrotask(() => { log.push("microtask"); try { Slot.cancel(); } catch (error: unknown) { fault = error; log.push("caught"); } }); };
    const survivor = (): void => { log.push("survivor:" + value); seen.push(value * 10); };
    Slot.handle = 0;   log.push("sync");
    await Promise.resolve(); fired(); await Promise.resolve(); survivor(); sentinel(); await done; log.push("after");
    assert.compareArray(log, ["sync", "fired:" + value, "microtask", "clear-fired", "survivor:" + value, "sentinel", "after"]);
    assert.compareArray(seen, [value, value * 10]); assert.sameValue(fault, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
