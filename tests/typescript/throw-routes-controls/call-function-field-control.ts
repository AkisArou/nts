/*---
description: Control for call-function-field; the same throwing body is called directly inside the caller try.
features: [ts-throw-route-call, ts-errors, ts-unknown, ts-functions, ts-function-types, ts-class, ts-class-fields]
---*/
// Control: ../throw-routes/call-function-field.ts; only the routed call becomes direct.
const callLog: string[] = []; let callState = 0; let callOriginal = new RangeError("unset");
function callBody(input: number, label: string, variant: number): number {
  const value = input * variant; callState += input + 7; callLog.push(`body:${`${label}:${input}:${variant}`}:${callState}`);
  try { if (input < 0) { callLog.push(`throw:${callOriginal.message}:${callState}`); throw callOriginal; }
    callLog.push(`return:${String(value)}:${callState}`); return value;
  } finally { callState += 10; callLog.push(`body-finally:${callState}`); }
}
function callFirst(input: number): number { return callBody(input, "first", 2); }
function callSecond(input: number): number { return callBody(input, "second", 3); }
class CallHolder {
  handler: (input: number) => number;
  constructor(handler: (input: number) => number) { this.handler = handler; }
}
for (const input of [-2, 0, 3]) for (const variant of [2, 3]) {
  callLog.length = 0; callState = 0;
  const label = variant === 2 ? "first" : "second";
  const holder = new CallHolder(variant === 2 ? callFirst : callSecond);
  const message = `${label}:${input}`; callOriginal = new RangeError(message);
  let result: number | undefined; let caught = false;
  callLog.push(`enter:${label}:${input}:0`);
  try {
    try { result = callBody(input, label, variant); callLog.push(`result:${String(result)}:${callState}`); }
    finally { callState += 100; callLog.push(`route-finally:${callState}`); }
  } catch (error: unknown) {
    assert.sameValue(error, callOriginal); assert.sameValue(error instanceof RangeError, true);
    if (error instanceof RangeError) assert.sameValue(error.message, message); else throw error;
    caught = true; callState += 1000; callLog.push(`catch:${message}:${callState}`);
  } finally { callState += 10000; callLog.push(`caller-finally:${callState}`); }
  const entered = input + 7, exited = entered + 10;
  assert.sameValue(result, input < 0 ? undefined : input * variant); assert.sameValue(caught, input < 0);
  assert.sameValue(callState, exited + 10100 + (input < 0 ? 1000 : 0));
  const expected = [`enter:${label}:${input}:0`];
  expected.push(`body:${`${label}:${input}:${variant}`}:${entered}`, input < 0 ? `throw:${message}:${entered}` : `return:${String(input * variant)}:${entered}`, `body-finally:${exited}`);
  if (input >= 0) expected.push(`result:${String(input * variant)}:${exited}`);
  expected.push(`route-finally:${exited + 100}`); if (input < 0) expected.push(`catch:${message}:${exited + 1100}`);
  expected.push(`caller-finally:${exited + 10100 + (input < 0 ? 1000 : 0)}`); assert.compareArray(callLog, expected);
}
