/*---
description: "An earlier timer callback cancels a later same-delay timeout through an instance field. The control uses direct callbacks."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-class, ts-class-fields, ts-this, ts-null-undefined, ts-unions, ts-errors]
flags: [async]
---*/
// The first callback clears the field-held handle; node omits the later target while preserving its same-delay survivor and final sentinel. The control calls only the surviving callbacks.
const log: string[] = [];
class Slot { handle: number | undefined; cancel(): void { log.push("clear"); { const cleared = this.handle; } } }
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const delay of [1, 4]) {
    log.length = 0; const slot = new Slot(), seen: number[] = []; let fault: unknown;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    const target = (): void => { log.push("target:" + value); seen.push(value); };
    const survivor = (): void => { log.push("survivor:" + value); seen.push(value * 10); };
    const controller = (): void => { log.push("controller"); try { slot.cancel(); } catch (error: unknown) { fault = error; log.push("caught"); } };
     slot.handle = 0;   log.push("sync");
    await Promise.resolve(); controller(); survivor(); sentinel(); await done; log.push("after");
    assert.compareArray(log, ["sync", "controller", "clear", "survivor:" + value, "sentinel", "after"]);
    assert.compareArray(seen, [value * 10]); assert.sameValue(fault, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
