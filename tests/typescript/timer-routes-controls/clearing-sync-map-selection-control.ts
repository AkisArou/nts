/*---
description: "A selected Map handle cancels only its named timeout. The control uses direct callbacks."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-map-set, ts-null-undefined, ts-unions]
flags: [async]
---*/
// Map values carry three opaque handles; node omits only the selected callback and preserves creation order and values of the other two. The control calls only the surviving callbacks.
const log: string[] = [];
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const selected of [0, 1, 2]) {
    log.length = 0; const handles = new Map<string, number>(), seen: number[] = [], values = [value, value + 1, value + 2], callbacks: (() => void)[] = [], delay = 2;
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel"); finish(); };
    for (let index = 0; index < values.length; index++) { const item = values[index]; callbacks.push(() => { log.push("fire:" + index + ":" + item); seen.push(item); }); }
    for (let index = 0; index < callbacks.length; index++) handles.set(String(index), 0);
    log.push("clear:" + selected); { const cleared = handles.get(String(selected)); }
     log.push("sync"); await Promise.resolve(); for (let index = 0; index < callbacks.length; index++) if (index !== selected) callbacks[index](); sentinel(); await done; log.push("after");
    const expected = ["clear:" + selected, "sync"]; for (let index = 0; index < values.length; index++) if (index !== selected) expected.push("fire:" + index + ":" + values[index]); expected.push("sentinel", "after");
    assert.compareArray(log, expected); assert.compareArray(seen, values.filter((_, index) => index !== selected)); assert.sameValue(seen.length, 2);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
