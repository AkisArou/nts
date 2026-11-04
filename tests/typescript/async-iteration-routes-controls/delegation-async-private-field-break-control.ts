/*---
description: "Control: Breaking async yield delegation through a private iterator field; node waits for inner cleanup before outer cleanup and leaves the inner generator finished."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-symbols, ts-arrow-functions]
flags: [async]
---*/
// Breaking async yield delegation through a private iterator field; node waits for inner cleanup before outer cleanup and leaves the inner generator finished.
const log: string[] = [];
function make(input: number[]): AsyncIterableIterator<number, void, void> {
  let index = 0, closed = false;
  async function close(): Promise<IteratorResult<number, void>> { closed = true; log.push("inner:finally:start"); await Promise.resolve(); log.push("inner:finally:end"); return { value: undefined, done: true }; }
  return { [Symbol.asyncIterator]() { return this; }, async next() {
    if (closed) return { value: undefined, done: true }; if (index === input.length) return close();
    const value = input[index++]; log.push("inner:" + value); return { value: await Promise.resolve(value), done: false };
  }, async return() { return close(); } };
}
class Holder {
  #source: AsyncIterableIterator<number, void, void>;
  constructor(input: number[]) { this.#source = make(input); }
  read(): AsyncIterableIterator<number, void, void> { log.push("read"); return this.#source; }
}
async function main(): Promise<void> {
  for (const input of [[], [-0], [1, 2, 3]]) {
    log.length = 0; const holder = new Holder(input); const source = holder.read(); const values: number[] = [];
    try {
      log.push("outer:start"); const iterator = source[Symbol.asyncIterator](); const step = await iterator.next();
      if (step.done) log.push("outer:complete");
      else { const value = await step.value; log.push("body:" + value); values.push(value); if (iterator.return) await iterator.return(undefined); }
    } finally { log.push("outer:finally"); }
    log.push("after"); const again = await source.next(); const expected = ["read", "outer:start"];
    if (input.length) expected.push("inner:" + input[0], "body:" + input[0]);
    expected.push("inner:finally:start", "inner:finally:end"); if (!input.length) expected.push("outer:complete"); expected.push("outer:finally", "after");
    assert.compareArray(log, expected); assert.compareArray(values, input.slice(0, 1));
    assert.sameValue(again.done, true); assert.sameValue(again.value, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
