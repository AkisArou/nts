/*---
description: Promise.resolve adopts a generic PromiseLike view once; awaiting its native result twice preserves the single hook and reason.
features: [ts-async-route-values-thenables, ts-async, ts-generics, ts-interfaces, ts-class, ts-class-fields, ts-function-types, ts-unions, ts-errors, ts-unknown]
flags: [async]
---*/
// Route: PromiseLike<AwaitValue> runs one queued adoption; both native-promise awaits reuse its first settlement.
type AwaitValue = number | string | undefined | { id: number };
const log: unknown[] = [];
function same(actual: unknown, wanted: unknown): void { assert.sameValue(Object.is(actual, wanted), true); assert.sameValue(typeof actual, typeof wanted); assert.sameValue(actual instanceof Error, wanted instanceof Error); if (actual instanceof Error && wanted instanceof Error) assert.sameValue(actual.message, wanted.message); }
class AwaitDeferred<T> implements PromiseLike<T> {
  state: number = 0; value: T; alternate: T; reason: unknown; fail: boolean;
  constructor(value: T, alternate: T, reason: unknown, fail: boolean) { this.value = value; this.alternate = alternate; this.reason = reason; this.fail = fail; }
  then<R1 = T, R2 = never>(onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null, onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
    log.push("entered", this.value);
    if (!onFulfilled || !onRejected) throw new Error("Both callbacks are required");
    if (this.fail) {
      this.state++; log.push("reject", this.reason, this.state); const first = onRejected(this.reason);
      log.push("settled", this.reason, this.state); return Promise.resolve(first);
    }
    this.state++; log.push("resolve", this.value, this.state); const first = onFulfilled(this.value);
    log.push("settled", this.value, this.state); return Promise.resolve(first);
  }
}
async function main(): Promise<void> {
  const object = { id: 1 }, other = { id: 2 };
  const inputs: [AwaitValue, AwaitValue, unknown][] = [[7, -0, new RangeError("route")], [-0, "late", "reason"], ["中", undefined, -0], [undefined, other, undefined], [object, 7, { id: 3 }]];
  for (const [value, alternate, reason] of inputs) for (const fail of [false, true]) {
    log.length = 0; const source = new AwaitDeferred<AwaitValue>(value, alternate, reason, fail);
    const routed: PromiseLike<AwaitValue> = source;
    log.push("adopt", source.state); const adopted = Promise.resolve(routed); log.push("adopted", source.state);
    assert.sameValue(Object.is(adopted, source), false); assert.sameValue(typeof adopted, "object");
    queueMicrotask(() => log.push("checkpoint", source.state));
    for (const turn of [1, 2]) {
      log.push("await", turn); let caught = false;
      try { const result = await adopted; log.push("resumed", result, turn); same(result, value); }
      catch (error: unknown) { caught = true; log.push("caught", error, turn); same(error, reason); }
      finally { log.push("finally", source.state, turn); }
      same(caught, fail); same(source.state, 1);
    }
    assert.compareArray(log, ["adopt", 0, "adopted", 0, "await", 1, "entered", value, fail ? "reject" : "resolve", fail ? reason : value, 1, "settled", fail ? reason : value, 1, "checkpoint", 1, fail ? "caught" : "resumed", fail ? reason : value, 1, "finally", 1, 1, "await", 2, fail ? "caught" : "resumed", fail ? reason : value, 2, "finally", 1, 2]);
    same(source.value, value); same(source.state, 1);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error instanceof Error ? error : new Error(String(error))));
