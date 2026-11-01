/*---
description: Base typed async calls retain overrides through two derived levels and mixed settlements
features: [ts-async-route-methods, ts-async, ts-errors, ts-unknown, ts-inheritance, ts-override]
flags: [async]
---*/
// Alpha holds Alpha, Beta or Gamma; node runs the final override and its finally exactly once.
type AsyncValue = number | string | undefined | { id: number };
const log: unknown[] = [];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface AsyncState { kind: string; calls: number; closed: number; held: AsyncValue; }
class Alpha implements AsyncState { kind: string = "alpha"; calls: number = 0; closed: number = 0; held: AsyncValue = undefined; async run(source: Promise<AsyncValue>): Promise<AsyncValue> { log.push("Alpha.enter", this, this.calls += 1, this.held); try { const value = await source; log.push("Alpha.resume", this, value); same(value, this.held); log.push("Alpha.return", this, value); return value; } finally { this.closed++; log.push("Alpha.finally", this, this.closed); } } }
class Beta extends Alpha { override kind: string = "beta"; override async run(source: Promise<AsyncValue>): Promise<AsyncValue> { log.push("Beta.enter", this, this.calls += 2, this.held); try { const value = await source; log.push("Beta.resume", this, value); same(value, this.held); log.push("Beta.return", this, value); return value; } finally { this.closed++; log.push("Beta.finally", this, this.closed); } } }
class Gamma extends Beta { override kind: string = "gamma"; override async run(source: Promise<AsyncValue>): Promise<AsyncValue> { log.push("Gamma.enter", this, this.calls += 3, this.held); try { const value = await source; log.push("Gamma.resume", this, value); same(value, this.held); log.push("Gamma.return", this, value); return value; } finally { this.closed++; log.push("Gamma.finally", this, this.closed); } } }
async function main(): Promise<void> {
  const object = { id: 7 }; const inputs: AsyncValue[] = [3, -0, "text", undefined, object];
  for (const value of inputs) for (const pending of [false, true]) for (const failure of [undefined, new RangeError("method fault"), "plain fault"]) {
    const receivers: Alpha[] = [new Alpha(), new Beta(), new Gamma()]; const labels: string[] = ["Alpha", "Beta", "Gamma"];
    for (let index = 0; index < receivers.length; index++) {
      log.length = 0; const receiver = receivers[index]; receiver.held = value; const failed = failure !== undefined;
      const source = new Promise<AsyncValue>((resolve, reject) => {
        const settle = (): void => { log.push(failed ? "reject" : "resolve", failed ? failure : value); if (failed) reject(failure); else resolve(value); };
        if (pending) queueMicrotask(settle); else settle();
      });
      let settled: boolean = false;
      try {
        log.push("call", receiver, value); const result = await (receiver.run(source));
        settled = true; log.push("settled", result); same(result, value);
      } catch (error: unknown) { log.push("caught", error); same(error, failure); assert.sameValue(failed, true);
        if (error instanceof RangeError) { assert.sameValue(error.constructor, RangeError); assert.sameValue(error.message, "method fault"); }
      } finally { log.push("caller-finally", receiver, receiver.closed); }
      assert.sameValue(settled, !failed); same(receiver.held, value); assert.sameValue(receiver.calls, index + 1); assert.sameValue(receiver.closed, 1);
      const expected: unknown[] = []; const settlement: unknown[] = [failed ? "reject" : "resolve", failed ? failure : value]; const label = labels[index];
      if (!pending) expected.push(...settlement); expected.push("call", receiver, value, label + ".enter", receiver, index + 1, value);
      if (pending) expected.push(...settlement);
      if (!failed) expected.push(label + ".resume", receiver, value, label + ".return", receiver, value);
      expected.push(label + ".finally", receiver, 1, failed ? "caught" : "settled", failed ? failure : value, "caller-finally", receiver, 1); assert.compareArray(log, expected);
    }
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
