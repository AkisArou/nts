/*---
description: Control for unwind-finally-return; the throwing body is called directly inside the caller try with the same unwind observations.
features: [ts-throw-route-unwind, ts-errors, ts-unknown, ts-functions, ts-function-types]
---*/
// Control: ../throw-routes/unwind-finally-return.ts; the caller directly invokes the throwing body and preserves the same cleanup.
for (const input of [-2, 0, 3]) {
  const original = new RangeError(`unwind:${input}`);
  const log: string[] = []; let state = 0;
  function note(label: string, amount: number): void { state += amount; log.push(`${label}:${state}`); }
  let innerCaught: unknown;
  function returningFinally(value: number): number {
    note(`target:${value}`, 1);
    try {
      try {
        if (value < 0) { note("throw", 2); throw original; }
        note("return", 3); return value * 2;
      } catch (error: unknown) {
        innerCaught = error; note("inner:catch", 4); assert.sameValue(error, original);
        assert.sameValue(error instanceof RangeError, true);
        if (error instanceof RangeError) assert.sameValue(error.message, `unwind:${input}`);
        note("inner:rethrow", 5); throw error;
      }
    } finally { note("target:finally", 10); if (value < 0) { note("finally:return", 6); return value - 100; } }
  }
  const routed: (value: number) => number = returningFinally;
  let result: number | undefined; let caught: unknown;
  try { note("caller:enter", 0); result = returningFinally(input); note("caller:return", 0); }
  catch (error: unknown) {
    caught = error; note("caller:catch", 0);
    assert.sameValue(error, original); assert.sameValue(error instanceof RangeError, true);
    if (error instanceof RangeError) assert.sameValue(error.message, `unwind:${input}`);
  } finally { note("caller:finally", 100); }
  assert.sameValue(caught, undefined); assert.sameValue(result, input < 0 ? input - 100 : input * 2);
  assert.sameValue(innerCaught, input < 0 ? original : undefined);
  assert.sameValue(state, input < 0 ? 128 : 114);
  assert.compareArray(log, input < 0
    ? ["caller:enter:0", `target:${input}:1`, "throw:3", "inner:catch:7", "inner:rethrow:12", "target:finally:22", "finally:return:28", "caller:return:28", "caller:finally:128"]
    : ["caller:enter:0", `target:${input}:1`, "return:4", "target:finally:14", "caller:return:14", "caller:finally:114"]);
}
