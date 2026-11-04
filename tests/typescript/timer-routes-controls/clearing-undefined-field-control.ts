/*---
description: "Both clear functions accept an undefined instance field without disturbing pending work. The control uses direct callbacks."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-class, ts-class-fields, ts-this, ts-null-undefined, ts-unions]
flags: [async]
---*/
// An optional handle field is still undefined; node accepts both clear calls and runs the already scheduled survivor and last sentinel normally. The control calls only the surviving callbacks.
const log: string[] = [];
class Slot {
  handle: number | undefined = undefined;
  cancel(): void { log.push("clear-timeout"); { const cleared = this.handle; } log.push("clear-interval"); { const cleared = this.handle; } }
}
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const delay of [1, 4]) {
    log.length = 0; const slot = new Slot(), seen: number[] = [];
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    const survivor = (): void => { log.push("survivor:" + value); seen.push(value); };
     slot.cancel();  log.push("sync"); await Promise.resolve(); survivor(); sentinel(); await done; log.push("after");
    assert.compareArray(log, ["clear-timeout", "clear-interval", "sync", "survivor:" + value, "sentinel", "after"]);
    assert.compareArray(seen, [value]); assert.sameValue(seen.length, 1);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
