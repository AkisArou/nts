/*---
description: A function with a declared this parameter throws through a typed method call while preserving its actual receiver.
features: [ts-throw-route-call, ts-errors, ts-unknown, ts-functions, ts-interfaces, ts-function-types, ts-this, ts-this-parameter, ts-objects]
---*/
// Route: method with a declared this parameter -> caller outer catch; Node preserves the original error and body/route/caller finally order.
const callLog: string[] = []; let callState = 0; let callOriginal = new RangeError("unset");
interface CallService { label: string; offset: number; variant: number; run: (this: CallService, input: number) => number; }
let callExpectedReceiver: unknown;
function callBody(receiver: CallService, input: number, variant: number): number {
  assert.sameValue(receiver, callExpectedReceiver); const value = input * variant + receiver.offset; callState += input + 7; callLog.push(`body:${`${receiver.label}:${input}:${receiver.offset}:${variant}`}:${callState}`);
  try { if (input < 0) { callLog.push(`throw:${callOriginal.message}:${callState}`); throw callOriginal; }
    callLog.push(`return:${String(value)}:${callState}`); return value;
  } finally { callState += 10; callLog.push(`body-finally:${callState}`); }
}
function callWithThis(this: CallService, input: number): number { return callBody(this, input, this.variant); }
const callOne: CallService = { label: "first", offset: 10, variant: 2, run: callWithThis };
const callTwo: CallService = { label: "second", offset: 20, variant: 3, run: callWithThis };
function dispatchCall(service: CallService, input: number): number { return service.run(input); }
for (const input of [-2, 0, 3]) for (const variant of [2, 3]) {
  callLog.length = 0; callState = 0;
  const label = variant === 2 ? "first" : "second", offset = variant === 2 ? 10 : 20;
  const receiver: CallService = variant === 2 ? callOne : callTwo; callExpectedReceiver = receiver;
  const message = `${label}:${input}`; callOriginal = new RangeError(message);
  let result: number | undefined; let caught = false;
  callLog.push(`enter:${label}:${input}:0`);
  try {
    try { result = dispatchCall(receiver, input); callLog.push(`result:${String(result)}:${callState}`); }
    finally { callState += 100; callLog.push(`route-finally:${callState}`); }
  } catch (error: unknown) {
    assert.sameValue(error, callOriginal); assert.sameValue(error instanceof RangeError, true);
    if (error instanceof RangeError) assert.sameValue(error.message, message); else throw error;
    caught = true; callState += 1000; callLog.push(`catch:${message}:${callState}`);
  } finally { callState += 10000; callLog.push(`caller-finally:${callState}`); }
  const entered = input + 7, exited = entered + 10;
  assert.sameValue(result, input < 0 ? undefined : input * variant + offset); assert.sameValue(caught, input < 0);
  assert.sameValue(callState, exited + 10100 + (input < 0 ? 1000 : 0));
  const expected = [`enter:${label}:${input}:0`];
  expected.push(`body:${`${label}:${input}:${offset}:${variant}`}:${entered}`, input < 0 ? `throw:${message}:${entered}` : `return:${String(input * variant + offset)}:${entered}`, `body-finally:${exited}`);
  if (input >= 0) expected.push(`result:${String(input * variant + offset)}:${exited}`);
  expected.push(`route-finally:${exited + 100}`); if (input < 0) expected.push(`catch:${message}:${exited + 1100}`);
  expected.push(`caller-finally:${exited + 10100 + (input < 0 ? 1000 : 0)}`); assert.compareArray(callLog, expected);
}
