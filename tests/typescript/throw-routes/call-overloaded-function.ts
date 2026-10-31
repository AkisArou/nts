/*---
description: An overloaded function called through overloaded signatures preserves both argument forms and the original throw.
features: [ts-throw-route-call, ts-errors, ts-unknown, ts-functions, ts-function-types, ts-overloads, ts-interfaces, ts-unions]
---*/
// Route: overloaded function-typed value -> caller outer catch; Node preserves the original error and body/route/caller finally order.
const callLog: string[] = []; let callState = 0; let callOriginal = new RangeError("unset");
interface CallOverload { (value: number): number; (value: string): string; }
function callBody(value: number): number;
function callBody(value: string): string;
function callBody(value: number | string): number | string {
  const input = Number(value), result = typeof value === "number" ? value * 2 : value + "!";
  callState += input + 7; callLog.push(`body:${typeof value}:${String(value)}:${arguments.length}:${callState}`);
  try {
    if (input < 0) { callLog.push(`throw:${callOriginal.message}:${callState}`); throw callOriginal; }
    callLog.push(`return:${String(result)}:${callState}`); return result;
  } finally { callState += 10; callLog.push(`body-finally:${callState}`); }
}
const callCallback: CallOverload = callBody;
for (const input of [-2, 0, 3]) for (const label of ["number", "string"]) {
  callLog.length = 0; callState = 0;
  const message = `${label}:${input}`; callOriginal = new RangeError(message);
  let result: number | string | undefined; let caught = false;
  callLog.push(`enter:${label}:${input}:0`);
  try {
    try { result = label === "number" ? callCallback(input) : callCallback(String(input)); callLog.push(`result:${String(result)}:${callState}`); }
    finally { callState += 100; callLog.push(`route-finally:${callState}`); }
  } catch (error: unknown) {
    assert.sameValue(error, callOriginal); assert.sameValue(error instanceof RangeError, true);
    if (error instanceof RangeError) assert.sameValue(error.message, message); else throw error;
    caught = true; callState += 1000; callLog.push(`catch:${message}:${callState}`);
  } finally { callState += 10000; callLog.push(`caller-finally:${callState}`); }
  const entered = input + 7, exited = entered + 10;
  assert.sameValue(result, input < 0 ? undefined : (label === "number" ? input * 2 : `${input}!`)); assert.sameValue(caught, input < 0);
  assert.sameValue(callState, exited + 10100 + (input < 0 ? 1000 : 0));
  const expected = [`enter:${label}:${input}:0`];
  expected.push(`body:${`${label}:${input}:1`}:${entered}`, input < 0 ? `throw:${message}:${entered}` : `return:${String(label === "number" ? input * 2 : `${input}!`)}:${entered}`, `body-finally:${exited}`);
  if (input >= 0) expected.push(`result:${String(label === "number" ? input * 2 : `${input}!`)}:${exited}`);
  expected.push(`route-finally:${exited + 100}`); if (input < 0) expected.push(`catch:${message}:${exited + 1100}`);
  expected.push(`caller-finally:${exited + 10100 + (input < 0 ? 1000 : 0)}`); assert.compareArray(callLog, expected);
}
