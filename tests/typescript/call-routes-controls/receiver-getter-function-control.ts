/*---
description: Control for receiver-getter-function; the call uses its direct form.
features: [ts-call-route-receiver, ts-functions, ts-function-types, ts-this, ts-errors, ts-class, ts-class-fields, ts-accessors, ts-this-parameter]
---*/
// Control: ../call-routes/receiver-getter-function.ts; only the call route is removed.
const log: string[] = [];
let state = 0;
const receivers: unknown[] = [];
function finish(value: number): number {
  log.push(`body:${value}:${state}`);
  if (value < 0) throw new RangeError(`negative:${value}`);
  return state * 2;
}
function action(this: void, value: number): number {
  receivers.push(this); state = 10 + value;
  log.push(`action:${value}:${state}`);
  if (value === -2) throw new RangeError(`negative:${value}`);
  return finish(value);
}
class Dispatcher {
  reads: number = 0;
  get handler(): (this: void, value: number) => number {
    this.reads++; log.push(`get:${this.reads}`);
    return action;
  }
}
for (const n of [-2, -1, 0, 3]) {
  log.length = 0; state = 0; receivers.length = 0;
  const dispatcher = new Dispatcher();
  const callback = dispatcher.handler;
  try {
    const result = action(n);
    assert.sameValue(result, 2 * (10 + n));
    log.push(`return:${result}:${state}`);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    assert.sameValue(error.constructor, RangeError);
    assert.sameValue(error.message, `negative:${n}`);
    log.push(`catch:${state}`);
  } finally { state += 100; log.push(`finally:${state}`); }
  assert.compareArray(receivers, [undefined]);
  assert.sameValue(state, 10 + n + 100);
  const expected = ["get:1", `action:${n}:${10 + n}`, `body:${n}:${10 + n}`];
  if (n === -2) expected.pop();
  expected.push(n < 0 ? `catch:${10 + n}` : `return:${2 * (10 + n)}:${10 + n}`);
  expected.push(`finally:${10 + n + 100}`);
  assert.compareArray(log, expected);
}
