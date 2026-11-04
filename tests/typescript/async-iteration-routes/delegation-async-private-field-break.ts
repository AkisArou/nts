/*---
description: "Breaking async yield delegation through a private iterator field; node waits for inner cleanup before outer cleanup and leaves the inner generator finished."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-generators, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-arrow-functions]
flags: [async]
---*/
// Breaking async yield delegation through a private iterator field; node waits for inner cleanup before outer cleanup and leaves the inner generator finished.
const log: string[] = [];
async function* make(input: number[]): AsyncIterableIterator<number, void, void> {
  try { for (const value of input) { log.push("inner:" + value); yield Promise.resolve(value); } }
  finally { log.push("inner:finally:start"); await Promise.resolve(); log.push("inner:finally:end"); }
}
class Holder {
  #source: AsyncIterableIterator<number, void, void>;
  constructor(input: number[]) { this.#source = make(input); }
  read(): AsyncIterableIterator<number, void, void> { log.push("read"); return this.#source; }
}
async function main(): Promise<void> {
  for (const input of [[], [-0], [1, 2, 3]]) {
    log.length = 0; const holder = new Holder(input); const source = holder.read(); const values: number[] = [];
    async function* outer(): AsyncIterableIterator<number, void, void> {
      try { log.push("outer:start"); yield* source; log.push("outer:complete"); }
      finally { log.push("outer:finally"); }
    }
    for await (const value of outer()) { log.push("body:" + value); values.push(value); break; }
    log.push("after"); const again = await source.next(); const expected = ["read", "outer:start"];
    if (input.length) expected.push("inner:" + input[0], "body:" + input[0]);
    expected.push("inner:finally:start", "inner:finally:end"); if (!input.length) expected.push("outer:complete"); expected.push("outer:finally", "after");
    assert.compareArray(log, expected); assert.compareArray(values, input.slice(0, 1));
    assert.sameValue(again.done, true); assert.sameValue(again.value, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
