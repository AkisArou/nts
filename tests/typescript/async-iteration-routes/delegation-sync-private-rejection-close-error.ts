/*---
description: "A rejected sync-iterator value through a private-field consumer; node calls return once and preserves the value rejection even when return throws a different class."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-objects, ts-unions, ts-symbols, ts-errors, ts-instanceof, ts-arrow-functions]
flags: [async]
---*/
// A rejected sync-iterator value through a private-field consumer; node calls return once and preserves the value rejection even when return throws a different class.
const log: string[] = [];
class Cursor implements IterableIterator<number | Promise<number>, void, void> {
  index: number = 0; closed: number = 0; count: number; failClose: boolean; reason: RangeError;
  constructor(count: number, failClose: boolean, reason: RangeError) { this.count = count; this.failClose = failClose; this.reason = reason; }
  [Symbol.iterator](): Cursor { log.push("iterator"); return this; }
  next(): IteratorResult<number | Promise<number>, void> {
    log.push("next:" + this.index); if (this.index < this.count) return { value: Promise.resolve(++this.index), done: false };
    this.index++; return { value: Promise.reject(this.reason), done: false };
  }
  return(): IteratorResult<number | Promise<number>, void> {
    this.closed++; log.push("return:" + arguments.length);
    if (this.failClose) { log.push("return:throw"); throw new TypeError("close"); } log.push("return:done"); return { value: undefined, done: true };
  }
}
class Reader {
  #source: Cursor;
  constructor(source: Cursor) { this.#source = source; }
  async read(): Promise<{ values: number[]; caught: unknown }> {
    const values: number[] = []; let caught: unknown = undefined;
    try { for await (const value of this.#source) { log.push("body:" + value); values.push(value); } }
    catch (error: unknown) { caught = error; log.push("catch"); }
    log.push("after"); return { values, caught };
  }
}
async function main(): Promise<void> {
  for (const count of [0, 1, 3]) for (const failClose of [false, true]) {
    log.length = 0; const reason = new RangeError("value"), source = new Cursor(count, failClose, reason); const result = await new Reader(source).read();
    const expected = ["iterator"], wanted: number[] = [];
    for (let index = 0; index < count; index++) { wanted.push(index + 1); expected.push("next:" + index, "body:" + (index + 1)); }
    expected.push("next:" + count, "return:0", failClose ? "return:throw" : "return:done", "catch", "after");
    assert.compareArray(log, expected); assert.compareArray(result.values, wanted);
    assert.sameValue(result.caught instanceof RangeError, true); assert.sameValue(result.caught, reason);
    assert.sameValue(source.closed, 1); assert.sameValue(source.index, count + 1);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
