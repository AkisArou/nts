/*---
description: "A promise reaction clears the latest handle stored in a static field. The control uses direct callbacks."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-class, ts-class-fields, ts-this, ts-null-undefined, ts-unions, ts-errors, ts-static]
flags: [async]
---*/
// The static handle is replaced after queuing a reaction; node reads the latest field in that reaction and leaves the earlier timeout active. The control calls only the surviving callbacks.
const log: string[] = [];
class Slot { static handle: number | undefined; static cancel(): void { log.push("clear-current"); { const cleared = this.handle; } } }
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const delay of [1, 4]) {
    log.length = 0; const seen: number[] = []; let fault: unknown;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    const first = (): void => { log.push("first:" + value); seen.push(value); };
    const second = (): void => { log.push("second:" + value); seen.push(value * 10); };
    Slot.handle = 0;
    const canceled = Promise.resolve().then(() => { log.push("reaction"); try { Slot.cancel(); } catch (error: unknown) { fault = error; log.push("caught"); } });
    Slot.handle = 0;  log.push("sync"); await canceled; first(); sentinel(); await done; log.push("after");
    assert.compareArray(log, ["sync", "reaction", "clear-current", "first:" + value, "sentinel", "after"]);
    assert.compareArray(seen, [value]); assert.sameValue(fault, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
