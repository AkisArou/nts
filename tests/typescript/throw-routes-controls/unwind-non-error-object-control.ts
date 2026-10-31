/*---
description: Control for unwind-non-error-object; the throwing body is called directly inside the caller try with the same unwind observations.
features: [ts-throw-route-unwind, ts-errors, ts-unknown, ts-functions, ts-interfaces, ts-objects, ts-narrowing]
---*/
// Control: ../throw-routes/unwind-non-error-object.ts; the caller directly invokes the throwing body and preserves the same cleanup.
interface UnwindPayload { tag: "payload"; value: number; }
interface UnwindPayloadPort { run(value: number): number; }
for (const input of [-2, 0, 3]) {
  const original: UnwindPayload = { tag: "payload", value: input };
  const log: string[] = []; let state = 0;
  function note(label: string, amount: number): void { state += amount; log.push(`${label}:${state}`); }
  function action(value: number): number {
    original.value++; note(`target:${value}:${original.value}`, 1);
    try {
      if (value < 0) { note("throw", 2); throw original; }
      note("return", 3); return value * 2;
    } finally { note("target:finally", 10); }
  }
  const port: UnwindPayloadPort = { run: action };
  let result: number | undefined; let caught: unknown;
  try { note("caller:enter", 0); result = action(input); note("caller:return", 0); }
  catch (error: unknown) {
    caught = error; note("caller:catch", 0); assert.sameValue(error, original);
    assert.sameValue(typeof error, "object"); assert.sameValue(error instanceof Error, false);
    if (typeof error === "object" && error !== null && "tag" in error && "value" in error) {
      assert.sameValue(error.tag, "payload"); assert.sameValue(error.value, input + 1);
    } else assert(false, "expected the payload object");
  } finally { note("caller:finally", 100); }
  assert.sameValue(caught, input < 0 ? original : undefined); assert.sameValue(result, input < 0 ? undefined : input * 2);
  assert.sameValue(original.value, input + 1); assert.sameValue(state, input < 0 ? 113 : 114);
  assert.compareArray(log, ["caller:enter:0", `target:${input}:${input + 1}:1`, input < 0 ? "throw:3" : "return:4",
    input < 0 ? "target:finally:13" : "target:finally:14", input < 0 ? "caller:catch:13" : "caller:return:14", input < 0 ? "caller:finally:113" : "caller:finally:114"]);
}
