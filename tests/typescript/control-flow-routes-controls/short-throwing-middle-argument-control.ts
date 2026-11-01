/*---
description: Control for short-throwing-middle-argument; A typed middle argument throws after earlier effects and skips the last argument and callee body.
features: [ts-control-flow-routes, ts-control-flow-route-short-circuit, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-expressions, ts-tuples, ts-closures, ts-function-types, ts-errors, ts-literal-types]
---*/
// A literal ArgumentMode selects returning or throwing ShortValue; node evaluates the callee and first argument before middle, catches the original payload and suppresses all remaining call work on throw. The control spells the tested evaluation out in ordered steps.
type ShortValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const rows: [ShortValue, boolean, boolean][] = [[0, false, false], [-0, false, false], [NaN, false, false], ["", false, false], [undefined, false, true], [null, false, true], [false, false, false], [marker, true, false], [7, true, false], ["go", true, false], [true, true, false], [replacement, true, false]];
type ArgumentMode = "return" | "throw";
const modes: ArgumentMode[] = ["return", "throw"];
function inspect(input: ShortValue, mode: ArgumentMode): void {
  const log: unknown[] = []; let state: ShortValue = input, actual: ShortValue = marker, caught: unknown; let didCatch = false;
  function call(a: ShortValue, b: ShortValue, c: ShortValue): ShortValue { log.push("call", a, b, c); return a; }
  function callee(): (a: ShortValue, b: ShortValue, c: ShortValue) => ShortValue { log.push("callee", state); return call; }
  function first(): ShortValue { state = replacement; log.push("first", input, "write", state); return input; }
  function middle(): ShortValue {
    log.push("middle", state, mode);
    if (mode === "throw") { log.push("throw", input); throw input; }
    state = null; log.push("middle-return", replacement, "write", state); return replacement;
  }
  function last(): ShortValue { log.push("last", state); return state; }
  try { const target = callee(), a = first(), b = middle(), c = last(); actual = target(a, b, c); log.push("returned", actual); }
  catch (error: unknown) { didCatch = true; caught = error; log.push("caught", error); }
  const expectedLog: unknown[] = ["callee", input, "first", input, "write", replacement, "middle", replacement, mode];
  let expected: ShortValue = input, expectedState: ShortValue = null;
  if (mode === "throw") { expected = marker; expectedState = replacement; expectedLog.push("throw", input, "caught", input); same(caught, input); }
  else { expectedLog.push("middle-return", replacement, "write", null, "last", null, "call", input, replacement, null, "returned", input); same(caught, undefined); }
  same(actual, expected); same(state, expectedState); same(didCatch, mode === "throw"); assert.compareArray(log, expectedLog);
}
for (const row of rows) for (const mode of modes) inspect(row[0], mode);
