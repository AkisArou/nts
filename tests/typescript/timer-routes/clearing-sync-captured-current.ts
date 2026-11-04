/*---
description: "A cancellation closure reads the replacement handle from its live let binding."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-null-undefined, ts-unions]
flags: [async]
---*/
// A captured let is overwritten by the second timeout; node clears the replacement and still delivers the first callback value.
const log: string[] = [];
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const delay of [1, 4]) {
    log.length = 0; const seen: number[] = []; let current: number | undefined;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    const cancel = (): void => { log.push("clear-current"); clearTimeout(current); };
    const first = (): void => { log.push("first:" + value); seen.push(value); };
    const second = (): void => { log.push("second:" + value); seen.push(value * 10); };
    current = setTimeout(first, delay); current = setTimeout(second, delay);
    cancel(); setTimeout(sentinel, delay); log.push("sync"); await done; log.push("after");
    assert.compareArray(log, ["clear-current", "sync", "first:" + value, "sentinel", "after"]);
    assert.compareArray(seen, [value]); assert.sameValue(seen.length, 1);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
