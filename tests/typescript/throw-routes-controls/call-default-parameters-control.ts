/*---
description: Control for call-default-parameters; the same throwing body is called directly inside the caller try.
features: [ts-throw-route-call, ts-errors, ts-unknown, ts-functions, ts-function-types, ts-default-parameters]
---*/
// Control: ../throw-routes/call-default-parameters.ts; only the routed call becomes direct.
const callLog: string[] = []; let callState = 0; let callOriginal = new RangeError("unset");
function callDefault(): number { callState++; callLog.push(`default:${callState}`); return 5; }
function callBody(input: number, extra: number = callDefault()): number {
  const value = input + (extra ?? 5); callState += input + 7; callLog.push(`body:${`${input}:${arguments.length}:${String(extra)}`}:${callState}`);
  try { if (input < 0) { callLog.push(`throw:${callOriginal.message}:${callState}`); throw callOriginal; }
    callLog.push(`return:${String(value)}:${callState}`); return value;
  } finally { callState += 10; callLog.push(`body-finally:${callState}`); }
}
const callCallback: (input: number, extra?: number) => number = callBody;
for (const input of [-2, 0, 3]) for (const supplied of [false, true]) {
  callLog.length = 0; callState = 0;
  const label = supplied ? "supplied" : "omitted";
  const message = `${label}:${input}`; callOriginal = new RangeError(message);
  let result: number | undefined; let caught = false;
  callLog.push(`enter:${label}:${input}:0`);
  try {
    try { result = supplied ? callBody(input, input + 9) : callBody(input); callLog.push(`result:${String(result)}:${callState}`); }
    finally { callState += 100; callLog.push(`route-finally:${callState}`); }
  } catch (error: unknown) {
    assert.sameValue(error, callOriginal); assert.sameValue(error instanceof RangeError, true);
    if (error instanceof RangeError) assert.sameValue(error.message, message); else throw error;
    caught = true; callState += 1000; callLog.push(`catch:${message}:${callState}`);
  } finally { callState += 10000; callLog.push(`caller-finally:${callState}`); }
  const entered = input + 7 + (supplied ? 0 : 1), exited = entered + 10;
  assert.sameValue(result, input < 0 ? undefined : (input + (supplied ? input + 9 : 5))); assert.sameValue(caught, input < 0);
  assert.sameValue(callState, exited + 10100 + (input < 0 ? 1000 : 0));
  const expected = [`enter:${label}:${input}:0`];
  if (!supplied) expected.push("default:1");
  expected.push(`body:${`${input}:${supplied ? 2 : 1}:${String(supplied ? input + 9 : 5)}`}:${entered}`, input < 0 ? `throw:${message}:${entered}` : `return:${String(input + (supplied ? input + 9 : 5))}:${entered}`, `body-finally:${exited}`);
  if (input >= 0) expected.push(`result:${String(input + (supplied ? input + 9 : 5))}:${exited}`);
  expected.push(`route-finally:${exited + 100}`); if (input < 0) expected.push(`catch:${message}:${exited + 1100}`);
  expected.push(`caller-finally:${exited + 10100 + (input < 0 ? 1000 : 0)}`); assert.compareArray(callLog, expected);
}
