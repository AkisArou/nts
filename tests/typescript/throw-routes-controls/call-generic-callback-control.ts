/*---
description: Control for call-generic-callback; the same throwing body is called directly inside the caller try.
features: [ts-throw-route-call, ts-errors, ts-unknown, ts-functions, ts-function-types, ts-generics, ts-interfaces, ts-objects]
---*/
// Control: ../throw-routes/call-generic-callback.ts; only the routed call becomes direct.
const callLog: string[] = []; let callState = 0; let callOriginal = new RangeError("unset");
interface CallRecord { label: string; value: number; }
function callBody<T>(input: number, received: string, value: T): T {
  callState += input + 7; callLog.push(`body:${received}:${callState}`);
  try {
    if (input < 0) { callLog.push(`throw:${callOriginal.message}:${callState}`); throw callOriginal; }
    callLog.push(`return:${typeof value}:${callState}`); return value;
  } finally { callState += 10; callLog.push(`body-finally:${callState}`); }
}
function callNumber(value: number): number { return callBody(value, `number:${value}`, value * 2); }
function callString(value: string): string { return callBody(Number(value), `string:${value}`, value + "!"); }
function callRecord(value: CallRecord): CallRecord { return callBody(value.value, `record:${value.label}:${value.value}`, value); }
function dispatchCall<T, U>(callback: (value: T) => U, value: T): U { return callback(value); }
for (const input of [-2, 0, 3]) for (const label of ["number", "string", "record"]) {
  callLog.length = 0; callState = 0;
  const record: CallRecord = { label: "record", value: input };
  const returnedType = label === "record" ? "object" : label;
  const message = `${label}:${input}`; callOriginal = new RangeError(message);
  let result: number | string | CallRecord | undefined; let caught = false;
  callLog.push(`enter:${label}:${input}:0`);
  try {
    try { if (label === "number") result = callNumber(input); else if (label === "string") result = callString(String(input)); else result = callRecord(record); callLog.push(`result:${typeof result}:${callState}`); }
    finally { callState += 100; callLog.push(`route-finally:${callState}`); }
  } catch (error: unknown) {
    assert.sameValue(error, callOriginal); assert.sameValue(error instanceof RangeError, true);
    if (error instanceof RangeError) assert.sameValue(error.message, message); else throw error;
    caught = true; callState += 1000; callLog.push(`catch:${message}:${callState}`);
  } finally { callState += 10000; callLog.push(`caller-finally:${callState}`); }
  const entered = input + 7, exited = entered + 10;
  assert.sameValue(result, input < 0 ? undefined : (label === "number" ? input * 2 : label === "string" ? `${input}!` : record)); assert.sameValue(caught, input < 0);
  assert.sameValue(callState, exited + 10100 + (input < 0 ? 1000 : 0));
  const expected = [`enter:${label}:${input}:0`];
  expected.push(`body:${label === "record" ? `record:record:${input}` : `${label}:${input}`}:${entered}`, input < 0 ? `throw:${message}:${entered}` : `return:${returnedType}:${entered}`, `body-finally:${exited}`);
  if (input >= 0) expected.push(`result:${returnedType}:${exited}`);
  expected.push(`route-finally:${exited + 100}`); if (input < 0) expected.push(`catch:${message}:${exited + 1100}`);
  expected.push(`caller-finally:${exited + 10100 + (input < 0 ? 1000 : 0)}`); assert.compareArray(callLog, expected);
}
