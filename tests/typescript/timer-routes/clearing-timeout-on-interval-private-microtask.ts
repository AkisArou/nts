/*---
description: "A microtask uses clearTimeout to cancel a private-field interval before any tick."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-class, ts-class-fields, ts-this, ts-null-undefined, ts-unions, ts-errors, ts-private-fields]
flags: [async]
---*/
// A private field retains the interval handle; node runs the cancellation microtask before timers and produces no tick before final cleanup.
const log: string[] = [];
class Slot {
  #handle: number | undefined;
  start(callback: () => void, delay: number): void { log.push("arm"); this.#handle = setInterval(callback, delay); }
  cancel(): void { log.push("clear-timeout"); clearTimeout(this.#handle); }
  cleanup(): void { log.push("cleanup"); clearInterval(this.#handle); }
}
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const delay of [1, 4]) {
    log.length = 0; const slot = new Slot(), seen: number[] = []; let ticks = 0, fault: unknown, finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); try { slot.cleanup(); } catch (error: unknown) { fault = error; log.push("caught"); } finish(); };
    const tick = (): void => { log.push("tick:" + value); seen.push(value); ticks++; };
    const survivor = (): void => { log.push("survivor:" + value); seen.push(value * 10); };
    slot.start(tick, delay); setTimeout(survivor, delay);
    const canceled = new Promise<void>((resolve) => queueMicrotask(() => { log.push("microtask"); try { slot.cancel(); } catch (error: unknown) { fault = error; log.push("caught"); } resolve(); }));
    setTimeout(sentinel, delay); log.push("sync"); await canceled; await done; log.push("after");
    assert.compareArray(log, ["arm", "sync", "microtask", "clear-timeout", "survivor:" + value, "sentinel", "cleanup", "after"]);
    assert.compareArray(seen, [value * 10]); assert.sameValue(ticks, 0); assert.sameValue(fault, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
