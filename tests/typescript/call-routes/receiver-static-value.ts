/*---
description: A static method called through a typed value has an undefined receiver in strict mode.
features: [ts-call-route-receiver, ts-functions, ts-function-types, ts-this, ts-errors, ts-class, ts-static, ts-this-parameter]
---*/
// Route: a static method becomes a function-typed value; node supplies undefined as this and carries its deeper throw.
const log: string[] = [];
let state = 0;
const receivers: unknown[] = [];
function finish(value: number): number {
  log.push(`body:${value}:${state}`);
  if (value < 0) throw new RangeError(`negative:${value}`);
  return state * 2;
}
class Calculator {
  static method(this: typeof Calculator | void, value: number): number {
    receivers.push(this); state = 10 + value;
    log.push(`static:${value}:${state}`);
    if (value === -2) throw new RangeError(`negative:${value}`);
    return finish(value);
  }
}
const callback: (this: void, value: number) => number = Calculator.method;
for (const n of [-2, -1, 0, 3]) {
  log.length = 0; state = 0; receivers.length = 0;
  try {
    const result = callback(n);
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
  const expected = [`static:${n}:${10 + n}`, `body:${n}:${10 + n}`];
  if (n === -2) expected.pop();
  expected.push(n < 0 ? `catch:${10 + n}` : `return:${2 * (10 + n)}:${10 + n}`);
  expected.push(`finally:${10 + n + 100}`);
  assert.compareArray(log, expected);
}
