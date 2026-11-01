/*---
description: Control for promise-generic-function; concrete async bodies or plain local promises retain the same awaits and observations.
features: [ts-async-route-promises, ts-async, ts-functions, ts-arrays, ts-errors, ts-generics]
flags: [async]
---*/
interface PromiseObject { id: number; }
type PromiseValue = number | string | undefined | PromiseObject;
const identity: PromiseObject = { id: 7 };
const inputs: PromiseValue[] = [7, -0, "text", undefined, identity];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
// Concrete functions retain the same gate, await, log, return and rejection.
async function readNumber(value: number, gate: Promise<void>, fail: boolean, fault: unknown, log: unknown[], state: { resumed: number }): Promise<number> {
  log.push("enter", value); try { await gate; state.resumed++; log.push("resume", value, state.resumed); if (fail) { log.push("throw", fault); throw fault; } log.push("return", value); return value; } finally { log.push("body-finally", value); }
}
async function readString(value: string, gate: Promise<void>, fail: boolean, fault: unknown, log: unknown[], state: { resumed: number }): Promise<string> {
  log.push("enter", value); try { await gate; state.resumed++; log.push("resume", value, state.resumed); if (fail) { log.push("throw", fault); throw fault; } log.push("return", value); return value; } finally { log.push("body-finally", value); }
}
async function readUndefined(value: undefined, gate: Promise<void>, fail: boolean, fault: unknown, log: unknown[], state: { resumed: number }): Promise<undefined> {
  log.push("enter", value); try { await gate; state.resumed++; log.push("resume", value, state.resumed); if (fail) { log.push("throw", fault); throw fault; } log.push("return", value); return value; } finally { log.push("body-finally", value); }
}
async function readObject(value: PromiseObject, gate: Promise<void>, fail: boolean, fault: unknown, log: unknown[], state: { resumed: number }): Promise<PromiseObject> {
  log.push("enter", value); try { await gate; state.resumed++; log.push("resume", value, state.resumed); if (fail) { log.push("throw", fault); throw fault; } log.push("return", value); return value; } finally { log.push("body-finally", value); }
}
async function main(): Promise<void> {
  for (const value of inputs) for (const pending of [false, true]) for (const fail of [false, true]) for (const fault of [new Error("promise fault"), "non-error"]) {
    const log: unknown[] = [], state = { resumed: 0 };
    const gate: Promise<void> = new Promise(resolve => { log.push("gate-created"); const finish = (): void => { log.push("gate-settled"); resolve(); }; if (pending) queueMicrotask(finish); else finish(); });
    let caught = false; log.push("call", value);
    try {
      let result: PromiseValue;
      if (typeof value === "number") result = await readNumber(value, gate, fail, fault, log, state);
      else if (typeof value === "string") result = await readString(value, gate, fail, fault, log, state);
      else if (value === undefined) result = await readUndefined(value, gate, fail, fault, log, state);
      else result = await readObject(value, gate, fail, fault, log, state);
      log.push("fulfilled", result); same(result, value);
    } catch (error: unknown) { caught = true; same(error, fault); if (error instanceof Error) assert.sameValue(error.message, "promise fault"); log.push("caught", error); }
    finally { log.push("caller-finally", value); }
    assert.sameValue(caught, fail); assert.sameValue(state.resumed, 1);
    const expected: unknown[] = ["gate-created"];
    if (!pending) expected.push("gate-settled"); expected.push("call", value, "enter", value);
    if (pending) expected.push("gate-settled");
    expected.push("resume", value, 1, fail ? "throw" : "return", fail ? fault : value, "body-finally", value, fail ? "caught" : "fulfilled", fail ? fault : value, "caller-finally", value);
    assert.compareArray(log, expected);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
