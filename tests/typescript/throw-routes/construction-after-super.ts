/*---
description: A throw crosses a subclass constructor after super returns; the caller catches the original error and no partial instance escapes.
features: [ts-throw-route-construction, ts-errors, ts-unknown, ts-class, ts-class-fields, ts-interfaces, ts-construct-signatures, ts-functions, ts-inheritance]
---*/
// Route: a subclass constructor after super returns -> caller catch; node preserves error identity, prior writes and finally order.
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
  function initializeBase(value: number): number { state++; log.push(`base:${value}:${state}`); return value; }
  class ConstructionParent implements ConstructedRouteValue {
    value: number;
    constructor(value: number) { this.value = initializeBase(value); }
  }
  class ConstructionChild extends ConstructionParent {
    constructor(value: number) { super(value); this.value = throwingStep(value); }
  }
  const Build: new (value: number) => ConstructedRouteValue = ConstructionChild;
  let escaped: ConstructedRouteValue | undefined; let caught: unknown;
  try {
    log.push(`caller:enter:${state}`); escaped = new Build(input);
    log.push(`caller:return:${state}`);
  } catch (error: unknown) {
    caught = error; log.push(`caller:catch:${state}`);
    assert.sameValue(error, original); assert.sameValue(error instanceof RangeError, true);
    if (error instanceof RangeError) assert.sameValue(error.message, `construction:${input}`);
  } finally { state += 100; log.push(`caller:finally:${state}`); }
  assert.sameValue(caught, input < 0 ? original : undefined);
  assert.sameValue(escaped === undefined, input < 0);
  if (escaped !== undefined) assert.sameValue(escaped.value, input * 3);
  const effect = 1 + input + 4, completed = effect + 10;
  assert.sameValue(state, completed + 100);
  const expected = ["caller:enter:0", `base:${input}:1`, `target:enter:${input}:1`, `effect:${effect}`,
    input < 0 ? `throw:${effect}` : `return:${input * 3}:${effect}`, `target:finally:${effect + 10}`];
  expected.push(input < 0 ? `caller:catch:${completed}` : `caller:return:${completed}`, `caller:finally:${completed + 100}`);
  assert.compareArray(log, expected);
}
