/*---
description: A function with rest parameters throws through a function-typed variable with both supplied and omitted arguments.
features: [ts-throw-route-call, ts-errors, ts-unknown, ts-functions, ts-function-types, ts-rest-parameters, ts-optional-parameters, ts-arrays]
---*/
// Route: rest parameters through a function-typed variable -> caller outer catch; Node preserves the original error and body/route/caller finally order.
const callLog: string[] = []; let callState = 0; let callOriginal = new RangeError("unset");
function callBody(input: number, ...extras: (number | undefined)[]): number {
  let value = input; for (const extra of extras) value += extra ?? 0; callState += input + 7; callLog.push(`body:${`${input}:${arguments.length}:${extras.length}:${extras.join(",")}`}:${callState}`);
  try { if (input < 0) { callLog.push(`throw:${callOriginal.message}:${callState}`); throw callOriginal; }
    callLog.push(`return:${String(value)}:${callState}`); return value;
  } finally { callState += 10; callLog.push(`body-finally:${callState}`); }
}
const callCallback: (input: number, first?: number, second?: number) => number = callBody;
for (const input of [-2, 0, 3]) for (const supplied of [false, true]) {
  callLog.length = 0; callState = 0;
  const label = supplied ? "supplied" : "omitted";
  const message = `${label}:${input}`; callOriginal = new RangeError(message);
  let result: number | undefined; let caught = false;
  callLog.push(`enter:${label}:${input}:0`);
  try {
    try { result = supplied ? callCallback(input, input + 9, 4) : callCallback(input); callLog.push(`result:${String(result)}:${callState}`); }
    finally { callState += 100; callLog.push(`route-finally:${callState}`); }
  } catch (error: unknown) {
    assert.sameValue(error, callOriginal); assert.sameValue(error instanceof RangeError, true);
    if (error instanceof RangeError) assert.sameValue(error.message, message); else throw error;
    caught = true; callState += 1000; callLog.push(`catch:${message}:${callState}`);
  } finally { callState += 10000; callLog.push(`caller-finally:${callState}`); }
  const entered = input + 7, exited = entered + 10;
  assert.sameValue(result, input < 0 ? undefined : (supplied ? input * 2 + 13 : input)); assert.sameValue(caught, input < 0);
  assert.sameValue(callState, exited + 10100 + (input < 0 ? 1000 : 0));
  const expected = [`enter:${label}:${input}:0`];
  expected.push(`body:${`${input}:${supplied ? 3 : 1}:${supplied ? 2 : 0}:${supplied ? `${input + 9},4` : ""}`}:${entered}`, input < 0 ? `throw:${message}:${entered}` : `return:${String(supplied ? input * 2 + 13 : input)}:${entered}`, `body-finally:${exited}`);
  if (input >= 0) expected.push(`result:${String(supplied ? input * 2 + 13 : input)}:${exited}`);
  expected.push(`route-finally:${exited + 100}`); if (input < 0) expected.push(`catch:${message}:${exited + 1100}`);
  expected.push(`caller-finally:${exited + 10100 + (input < 0 ? 1000 : 0)}`); assert.compareArray(callLog, expected);
}
