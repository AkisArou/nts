/*---
description: Control for receiver-method-field; the call uses its direct form.
features: [ts-call-route-receiver, ts-functions, ts-function-types, ts-this, ts-errors, ts-class, ts-class-fields, ts-this-parameter]
---*/
// Control: ../call-routes/receiver-method-field.ts; only the call route is removed.
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
  handler: (this: Receiver, value: number) => number = this.method;
  method(this: Receiver, value: number): number {
    receivers.push(this); state = this.base + value;
    log.push(`method:${value}:${state}`);
    if (value === -2) throw new RangeError(`negative:${value}`);
    return finish(value);
  }
  run(value: number): number { return this.method(value); }
}
const source = new Receiver(); source.base = 100;
const receiver = new Receiver(); receiver.handler = source.method;
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
  const expected = [`method:${n}:${10 + n}`, `body:${n}:${10 + n}`];
  if (n === -2) expected.pop();
  expected.push(n < 0 ? `catch:${10 + n}` : `return:${2 * (10 + n)}:${10 + n}`);
  expected.push(`finally:${10 + n + 100}`);
  assert.compareArray(log, expected);
}
