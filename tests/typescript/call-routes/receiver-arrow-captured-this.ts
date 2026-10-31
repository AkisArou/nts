/*---
description: An arrow moved into a typed field keeps the class receiver captured when it was created.
features: [ts-call-route-receiver, ts-functions, ts-function-types, ts-this, ts-errors, ts-class, ts-class-fields, ts-arrow-functions, ts-closures, ts-objects]
---*/
// Route: a captured-this arrow sits in a foreign typed field; node keeps its original receiver through return or throw.
const log: string[] = [];
let state = 0;
const receivers: unknown[] = [];
function finish(value: number): number {
  log.push(`body:${value}:${state}`);
  if (value < 0) throw new RangeError(`negative:${value}`);
  return state * 2;
}
class Receiver {
  base: number = 10;
  run(value: number): number {
    const callback: (value: number) => number = (x: number): number => {
      receivers.push(this); state = this.base + x;
      log.push(`arrow:${x}:${state}`);
      if (x === -2) throw new RangeError(`negative:${x}`);
      return finish(x);
    };
    const foreign: { base: number; handler: (value: number) => number } = { base: 100, handler: callback };
    return foreign.handler(value);
  }
}
const receiver = new Receiver();
for (const n of [-2, -1, 0, 3]) {
  log.length = 0; state = 0; receivers.length = 0;
  try {
    const result = receiver.run(n);
    assert.sameValue(result, 2 * (10 + n));
    log.push(`return:${result}:${state}`);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.constructor, RangeError);
    assert.sameValue(error.message, `negative:${n}`);
    log.push(`catch:${state}`);
  } finally { state += 100; log.push(`finally:${state}`); }
  assert.compareArray(receivers, [receiver]);
  assert.sameValue(state, 10 + n + 100);
  const expected = [`arrow:${n}:${10 + n}`, `body:${n}:${10 + n}`];
  if (n === -2) expected.pop();
  expected.push(n < 0 ? `catch:${10 + n}` : `return:${2 * (10 + n)}:${10 + n}`);
  expected.push(`finally:${10 + n + 100}`);
  assert.compareArray(log, expected);
}
