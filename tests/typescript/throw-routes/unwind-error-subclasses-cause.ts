/*---
description: Two Error subclasses cross an interface route with exact identity, class, message and cause references intact.
features: [ts-throw-route-unwind, ts-errors, ts-unknown, ts-functions, ts-interfaces, ts-class, ts-class-fields, ts-builtin-subclass, ts-unions]
---*/
// Route: interface method -> caller catch; node retains each subclass, original object and cause reference.
class UnwindParseFault extends TypeError { readonly code: string = "parse"; }
class UnwindRangeFault extends RangeError { readonly code: string = "range"; }
interface UnwindErrorPort { run(value: number): number; }
for (const input of [-2, 0, 3]) for (const kind of ["parse", "range"]) {
  const cause = { input, kind };
  const original = kind === "parse" ? new UnwindParseFault(`fault:${kind}:${input}`, { cause }) : new UnwindRangeFault(`fault:${kind}:${input}`, { cause });
  const log: string[] = []; let state = 0;
  function note(label: string, amount: number): void { state += amount; log.push(`${label}:${state}`); }
  function action(value: number): number {
    note(`target:${value}`, 1);
    try {
      if (value < 0) { note("throw", 2); throw original; }
      note("return", 3); return value * 2;
    } finally { note("target:finally", 10); }
  }
  const port: UnwindErrorPort = { run: action };
  let result: number | undefined; let caught: unknown;
  try { note("caller:enter", 0); result = port.run(input); note("caller:return", 0); }
  catch (error: unknown) {
    caught = error; note("caller:catch", 0); assert.sameValue(error, original);
    assert.sameValue(error instanceof UnwindParseFault, kind === "parse");
    assert.sameValue(error instanceof UnwindRangeFault, kind === "range");
    assert.sameValue(error instanceof Error, true);
    if (error instanceof Error) { assert.sameValue(error.message, `fault:${kind}:${input}`); assert.sameValue(error.cause, cause); }
    if (error instanceof UnwindParseFault || error instanceof UnwindRangeFault) assert.sameValue(error.code, kind);
  } finally { note("caller:finally", 100); }
  assert.sameValue(caught, input < 0 ? original : undefined); assert.sameValue(result, input < 0 ? undefined : input * 2);
  assert.sameValue(state, input < 0 ? 113 : 114);
  assert.compareArray(log, ["caller:enter:0", `target:${input}:1`, input < 0 ? "throw:3" : "return:4",
    input < 0 ? "target:finally:13" : "target:finally:14", input < 0 ? "caller:catch:13" : "caller:return:14", input < 0 ? "caller:finally:113" : "caller:finally:114"]);
}
