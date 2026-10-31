/*---
description: Control for call-override-from-base; the same throwing body is called directly inside the caller try.
features: [ts-throw-route-call, ts-errors, ts-unknown, ts-functions, ts-class, ts-class-fields, ts-override]
---*/
// Control: ../throw-routes/call-override-from-base.ts; only the routed call becomes direct.
const callLog: string[] = []; let callState = 0; let callOriginal = new RangeError("unset");
class CallService {
  label: string = "base"; offset: number = 0;
  run(input: number): number { return input; } invoke(input: number): number { return this.run(input); }
}
let callExpectedReceiver: unknown;
function callBody(receiver: CallService, input: number, variant: number): number {
  assert.sameValue(receiver, callExpectedReceiver); const value = input * variant + receiver.offset; callState += input + 7; callLog.push(`body:${`${receiver.label}:${input}:${receiver.offset}:${variant}`}:${callState}`);
  try { if (input < 0) { callLog.push(`throw:${callOriginal.message}:${callState}`); throw callOriginal; }
    callLog.push(`return:${String(value)}:${callState}`); return value;
  } finally { callState += 10; callLog.push(`body-finally:${callState}`); }
}
class CallOne extends CallService {
  override label: string = "first"; override offset: number = 10;
  override run(input: number): number { return callBody(this, input, 2); }
}
class CallTwo extends CallService {
  padding: string = "extra"; override offset: number = 20; override label: string = "second";
  override run(input: number): number { return callBody(this, input, 3); }
}
function dispatchCall(service: CallService, input: number): number { return service.invoke(input); }
for (const input of [-2, 0, 3]) for (const variant of [2, 3]) {
  callLog.length = 0; callState = 0;
  const label = variant === 2 ? "first" : "second", offset = variant === 2 ? 10 : 20;
  const receiver: CallService = variant === 2 ? new CallOne() : new CallTwo(); callExpectedReceiver = receiver;
  const message = `${label}:${input}`; callOriginal = new RangeError(message);
  let result: number | undefined; let caught = false;
  callLog.push(`enter:${label}:${input}:0`);
  try {
    try { result = callBody(receiver, input, variant); callLog.push(`result:${String(result)}:${callState}`); }
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
