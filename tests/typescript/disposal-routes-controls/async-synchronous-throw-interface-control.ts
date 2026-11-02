/*---
description: An async-disposable interface method distinguishes an immediate throw from a returned promise rejection without losing error identity.
features: [ts-disposal-route-async-disposal, ts-using, ts-async, ts-interfaces, ts-arrays, ts-errors, ts-unknown]
flags: [async]
---*/
// Explicit disposal control; An interface factory returns AsyncDisposable resources whose method throws or returns a rejecting promise; node awaits only the returned promise, preserving the caller boundary.
interface Factory { create(reject: boolean, fail: boolean, fault: unknown, log: unknown[]): AsyncDisposable; }
const factory: Factory = { create(reject, fail, fault, log) { return { [Symbol.asyncDispose](): Promise<void> { log.push("dispose", this); if (reject) return Promise.resolve().then(() => { log.push("settled"); if (fail) throw fault; }); if (fail) throw fault; return Promise.resolve(); } }; } };
async function consume(resource: AsyncDisposable, log: unknown[]): Promise<void> {
  try {
    const current = resource, method = current[Symbol.asyncDispose];
    try { assert.sameValue(current, resource); log.push("body"); }
    finally { await method.call(current); }
  } catch (error) { log.push("caught"); throw error; }
  log.push("outside");
}
async function main(): Promise<void> {
  const faults: unknown[] = [undefined, new TypeError("dispose"), { fault: true }];
  for (const fault of faults) for (const reject of [false, true]) for (const fail of [false, true]) {
    const log: unknown[] = [], resource = factory.create(reject, fail, fault, log); let failed = false, caught: unknown = undefined;
    const pending = consume(resource, log); log.push("caller");
    try { await pending; } catch (error) { failed = true; caught = error; } log.push("after");
    const expected: unknown[] = ["body", "dispose", resource];
    if (!reject && fail) expected.push("caught", "caller");
    else { expected.push("caller"); if (reject) expected.push("settled"); expected.push(fail ? "caught" : "outside"); }
    expected.push("after"); assert.compareArray(log, expected); assert.sameValue(failed, fail); assert.sameValue(caught, fail ? fault : undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
