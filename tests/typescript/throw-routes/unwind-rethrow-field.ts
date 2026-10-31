/*---
description: Rethrowing through a typed function field preserves identity at both handlers and every intervening finally effect.
features: [ts-throw-route-unwind, ts-errors, ts-unknown, ts-functions, ts-function-types, ts-objects]
---*/
// Route: function field -> middle rethrow -> caller catch; node keeps the same object at both handlers.
for (const input of [-2, 0, 3]) {
  const original = new RangeError(`unwind:${input}`);
  const log: string[] = []; let state = 0;
  function note(label: string, amount: number): void { state += amount; log.push(`${label}:${state}`); }
  function action(value: number): number {
    note(`target:${value}`, 1);
    try {
      if (value < 0) { note("throw", 2); throw original; }
      note("return", 3); return value * 2;
    } finally { note("target:finally", 10); }
  }
  let middleCaught: unknown;
  function rethrowing(value: number): number {
    note("middle:enter", 20);
    try { return action(value); }
    catch (error: unknown) {
      middleCaught = error; note("middle:catch", 4); assert.sameValue(error, original);
      assert.sameValue(error instanceof RangeError, true);
      if (error instanceof RangeError) assert.sameValue(error.message, `unwind:${input}`);
      note("middle:rethrow", 5); throw error;
    } finally { note("middle:finally", 30); }
  }
  const field: { invoke: (value: number) => number } = { invoke: rethrowing };
  let result: number | undefined; let caught: unknown;
  try { note("caller:enter", 0); result = field.invoke(input); note("caller:return", 0); }
  catch (error: unknown) {
    caught = error; note("caller:catch", 0);
    assert.sameValue(error, original); assert.sameValue(error instanceof RangeError, true);
    if (error instanceof RangeError) assert.sameValue(error.message, `unwind:${input}`);
  } finally { note("caller:finally", 100); }
  assert.sameValue(caught, input < 0 ? original : undefined); assert.sameValue(result, input < 0 ? undefined : input * 2);
  assert.sameValue(middleCaught, input < 0 ? original : undefined);
  assert.sameValue(state, input < 0 ? 172 : 164);
  assert.compareArray(log, input < 0
    ? ["caller:enter:0", "middle:enter:20", `target:${input}:21`, "throw:23", "target:finally:33", "middle:catch:37", "middle:rethrow:42", "middle:finally:72", "caller:catch:72", "caller:finally:172"]
    : ["caller:enter:0", "middle:enter:20", `target:${input}:21`, "return:24", "target:finally:34", "middle:finally:64", "caller:return:64", "caller:finally:164"]);
}
