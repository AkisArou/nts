/*---
description: A finally throw replaces an exception across an interface method; the caller receives the replacement object and ordered effects.
features: [ts-throw-route-unwind, ts-errors, ts-unknown, ts-functions, ts-interfaces]
---*/
// Route: interface method -> throwing finally -> caller catch; node delivers the replacement object.
for (const input of [-2, 0, 3]) {
  const original = new RangeError(`unwind:${input}`);
  const log: string[] = []; let state = 0;
  function note(label: string, amount: number): void { state += amount; log.push(`${label}:${state}`); }
  const replacement = new TypeError(`replacement:${input}`);
  function replacingFinally(value: number): number {
    note(`target:${value}`, 1);
    try {
      if (value < 0) { note("throw:original", 2); throw original; }
      note("return", 3); return value * 2;
    } finally {
      note("target:finally", 10);
      if (value < 0) { note("throw:replacement", 6); throw replacement; }
    }
  }
  interface ReplacingPort { run(value: number): number; }
  const port: ReplacingPort = { run: replacingFinally };
  let result: number | undefined; let caught: unknown;
  try { note("caller:enter", 0); result = port.run(input); note("caller:return", 0); }
  catch (error: unknown) {
    caught = error; note("caller:catch", 0);
    assert.sameValue(error, replacement); assert.sameValue(error instanceof TypeError, true);
    if (error instanceof TypeError) assert.sameValue(error.message, `replacement:${input}`);
  } finally { note("caller:finally", 100); }
  assert.sameValue(caught, input < 0 ? replacement : undefined); assert.sameValue(result, input < 0 ? undefined : input * 2);
  assert.sameValue(state, input < 0 ? 119 : 114);
  assert.compareArray(log, input < 0
    ? ["caller:enter:0", `target:${input}:1`, "throw:original:3", "target:finally:13", "throw:replacement:19", "caller:catch:19", "caller:finally:119"]
    : ["caller:enter:0", `target:${input}:1`, "return:4", "target:finally:14", "caller:return:14", "caller:finally:114"]);
}
