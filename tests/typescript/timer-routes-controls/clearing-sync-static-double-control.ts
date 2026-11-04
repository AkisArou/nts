/*---
description: "Repeated synchronous cancellation through a static handle is harmless. The control uses direct callbacks."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-class, ts-class-fields, ts-this, ts-null-undefined, ts-unions, ts-static]
flags: [async]
---*/
// A static method clears the same stored handle twice; node still runs the unrelated survivor exactly once and omits the target. The control calls only the surviving callbacks.
const log: string[] = [];
class Slot { static handle: number | undefined; static cancel(): void { log.push("clear"); { const cleared = this.handle; } } }
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const delay of [1, 4]) {
    log.length = 0; const seen: number[] = [];
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    const target = (): void => { log.push("target:" + value); seen.push(value); };
    const survivor = (): void => { log.push("survivor:" + value); seen.push(value + 1); };
    Slot.handle = 0;
    Slot.cancel(); Slot.cancel();  log.push("sync");
    await Promise.resolve(); survivor(); sentinel(); await done; log.push("after");
    assert.compareArray(log, ["clear", "clear", "sync", "survivor:" + value, "sentinel", "after"]);
    assert.compareArray(seen, [value + 1]); assert.sameValue(seen.length, 1);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
