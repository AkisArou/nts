/*---
description: "A controller callback uses clearTimeout on a Map-held interval before its first tick."
features: [ts-timer-routes, ts-timer-route-clearing, ts-async, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-arrays, ts-strings, ts-numbers, ts-unknown, ts-iteration, ts-map-set, ts-errors, ts-null-undefined, ts-unions]
flags: [async]
---*/
// The controller reads an interval handle through Map.get; node cancels the interval before its same-delay opportunity and leaves the survivor active.
const log: string[] = [];
async function main(): Promise<void> {
  for (const value of [2, 7]) for (const delay of [1, 4]) {
    log.length = 0; const handles = new Map<string, number>(), seen: number[] = []; let ticks = 0, fault: unknown, finish: () => void = () => {};
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const sentinel = (): void => { log.push("sentinel", "cleanup"); try { clearInterval(handles.get("tick")); } catch (error: unknown) { fault = error; log.push("caught"); } finish(); };
    const tick = (): void => { log.push("tick:" + value); seen.push(value); ticks++; };
    const survivor = (): void => { log.push("survivor:" + value); seen.push(value * 10); };
    const controller = (): void => { log.push("clear-timeout"); try { clearTimeout(handles.get("tick")); } catch (error: unknown) { fault = error; log.push("caught"); } };
    setTimeout(controller, delay); handles.set("tick", setInterval(tick, delay)); setTimeout(survivor, delay); setTimeout(sentinel, delay); log.push("sync");
    await done; log.push("after");
    assert.compareArray(log, ["sync", "clear-timeout", "survivor:" + value, "sentinel", "cleanup", "after"]);
    assert.compareArray(seen, [value * 10]); assert.sameValue(ticks, 0); assert.sameValue(fault, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
