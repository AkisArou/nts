/*---
description: Control for construction-parameter-property-argument; the throwing step is called directly in the caller try with identical effects.
features: [ts-throw-route-construction, ts-errors, ts-unknown, ts-class, ts-class-fields, ts-interfaces, ts-construct-signatures, ts-functions, ts-parameter-properties]
---*/
// Control: ../throw-routes/construction-parameter-property-argument.ts; only the construction route to the throwing step becomes a direct call.
interface ConstructedRouteValue { value: number; }
for (const input of [-2, 0, 3]) {
  const log: string[] = []; let state = 0;
  const original = new RangeError(`construction:${input}`);
  function throwingStep(value: number): number {
    log.push(`target:enter:${value}:${state}`);
    try {
      state += value + 4; log.push(`effect:${state}`);
      if (value < 0) { log.push(`throw:${state}`); throw original; }
      log.push(`return:${value * 3}:${state}`); return value * 3;
    } finally { state += 10; log.push(`target:finally:${state}`); }
  }
  class ConstructionArgument implements ConstructedRouteValue {
    constructor(public value: number) { state += 5; log.push(`constructed:${value}:${state}`); }
  }
  const Build: new (value: number) => ConstructedRouteValue = ConstructionArgument;
  let escaped: ConstructedRouteValue | undefined; let caught: unknown;
  try {
    log.push(`caller:enter:${state}`); const prepared = throwingStep(input); escaped = new Build(prepared);
    log.push(`caller:return:${state}`);
  } catch (error: unknown) {
    caught = error; log.push(`caller:catch:${state}`);
    assert.sameValue(error, original); assert.sameValue(error instanceof RangeError, true);
    if (error instanceof RangeError) assert.sameValue(error.message, `construction:${input}`);
  } finally { state += 100; log.push(`caller:finally:${state}`); }
  assert.sameValue(caught, input < 0 ? original : undefined);
  assert.sameValue(escaped === undefined, input < 0);
  if (escaped !== undefined) assert.sameValue(escaped.value, input * 3);
  const effect = input + 4, completed = effect + 10 + (input < 0 ? 0 : 5);
  assert.sameValue(state, completed + 100);
  const expected = ["caller:enter:0", `target:enter:${input}:0`, `effect:${effect}`,
    input < 0 ? `throw:${effect}` : `return:${input * 3}:${effect}`, `target:finally:${effect + 10}`];
  if (input >= 0) expected.push(`constructed:${input * 3}:${completed}`);
  expected.push(input < 0 ? `caller:catch:${completed}` : `caller:return:${completed}`, `caller:finally:${completed + 100}`);
  assert.compareArray(log, expected);
}
