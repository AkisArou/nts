/*---
description: Generic async class instances retain concrete number, string, undefined and object fields through fulfillment or rejection after suspension.
features: [ts-async-route-promises, ts-async, ts-functions, ts-arrays, ts-errors, ts-generics, ts-class]
flags: [async]
---*/
interface PromiseObject { id: number; }
type PromiseValue = number | string | undefined | PromiseObject;
const identity: PromiseObject = { id: 7 };
const inputs: PromiseValue[] = [7, -0, "text", undefined, identity];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
// A generic class reads its field after await; node keeps the concrete instantiation and receiver.
class PromiseBox<T extends PromiseValue> {
  value: T; constructor(value: T) { this.value = value; }
  async read(gate: Promise<void>, fail: boolean, fault: unknown, log: unknown[], state: { resumed: number }): Promise<T> { log.push("enter", this.value); try { await gate; state.resumed++; log.push("resume", this.value, state.resumed); if (fail) { log.push("throw", fault); throw fault; } log.push("return", this.value); return this.value; } finally { log.push("body-finally", this.value); } }
}
async function main(): Promise<void> {
  for (const value of inputs) for (const pending of [false, true]) for (const fail of [false, true]) for (const fault of [new Error("promise fault"), "non-error"]) {
    const log: unknown[] = [], state = { resumed: 0 };
    const gate: Promise<void> = new Promise(resolve => { log.push("gate-created"); const finish = (): void => { log.push("gate-settled"); resolve(); }; if (pending) queueMicrotask(finish); else finish(); });
    let caught = false; log.push("call", value);
    try {
      let result: PromiseValue;
      if (typeof value === "number") result = await new PromiseBox(value).read(gate, fail, fault, log, state);
      else if (typeof value === "string") result = await new PromiseBox(value).read(gate, fail, fault, log, state);
      else if (value === undefined) result = await new PromiseBox(value).read(gate, fail, fault, log, state);
      else result = await new PromiseBox(value).read(gate, fail, fault, log, state);
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
