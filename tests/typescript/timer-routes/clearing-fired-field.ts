/*---
description: "Clearing an already-fired field-held timeout leaves a later timer unaffected."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-class, ts-class-fields, ts-this, ts-null-undefined, ts-unions, ts-errors]
flags: [async]
---*/
// A later callback clears the completed timeout handle from a field; node does nothing to it and still delivers the unrelated survivor.
const log: string[] = [];
class Slot { handle: number | undefined; cancel(): void { log.push("clear-fired"); clearTimeout(this.handle); } }
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const delay of [1, 4]) {
    log.length = 0; const slot = new Slot(), seen: number[] = []; let fault: unknown;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    const fired = (): void => { log.push("fired:" + value); seen.push(value); };
    const survivor = (): void => { log.push("survivor:" + value); seen.push(value * 10); };
    const controller = (): void => { log.push("controller"); try { slot.cancel(); } catch (error: unknown) { fault = error; log.push("caught"); } };
    slot.handle = setTimeout(fired, delay); setTimeout(controller, delay); setTimeout(survivor, delay); setTimeout(sentinel, delay); log.push("sync");
    await done; log.push("after");
    assert.compareArray(log, ["sync", "fired:" + value, "controller", "clear-fired", "survivor:" + value, "sentinel", "after"]);
    assert.compareArray(seen, [value, value * 10]); assert.sameValue(fault, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
