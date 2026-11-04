/*---
description: "Async yield delegation through a Map value; node preserves each yielded promise and the completion promise, with explicit consumer and outer-return awaits."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-generators, ts-interfaces, ts-class, ts-class-fields, ts-readonly, ts-map-set, ts-symbols, ts-narrowing, ts-errors, ts-instanceof, ts-typeof-operator, ts-arrow-functions]
flags: [async]
---*/
// Async yield delegation through a Map value; node preserves each yielded promise and the completion promise, with explicit consumer and outer-return awaits.
const log: string[] = [];
interface Token { id: number; }
class CompletionSource implements AsyncIterableIterator<Promise<number>, Promise<Token>, void> {
  index: number = 0; readonly yielded: Promise<number>[] = [];
  readonly input: number[]; readonly completion: Promise<Token>;
  constructor(input: number[], completion: Promise<Token>) { this.input = input; this.completion = completion; for (const value of input) this.yielded.push(Promise.resolve(value)); }
  [Symbol.asyncIterator](): CompletionSource { log.push("iterator"); return this; }
  async next(): Promise<IteratorResult<Promise<number>, Promise<Token>>> {
    log.push("next:" + this.index);
    if (this.index === this.input.length) return { value: this.completion, done: true };
    return { value: this.yielded[this.index++], done: false };
  }
}
async function main(): Promise<void> {
  for (const input of [[], [-0], [1, 2, 3]]) {
    log.length = 0; const token: Token = { id: input.length }; const promise = Promise.resolve(token);
    const sources: Map<string, CompletionSource> = new Map([["selected", new CompletionSource(input, promise)]]);
    const selected = sources.get("selected"); if (!selected) throw new Error("source"); const source = selected;
    let retained: unknown = undefined; const values: number[] = [];
    async function take(observed: unknown): Promise<void> {
      log.push("promise"); assert.sameValue(observed, source.yielded[values.length]); assert.sameValue(observed instanceof Promise, true);
      if (!(observed instanceof Promise)) throw new Error("promise expected");
      const value: unknown = await observed; if (typeof value !== "number") throw new Error("number expected");
      log.push("body:" + value); values.push(value);
    }
    async function* outer(): AsyncIterableIterator<number, Token, void> {
      log.push("outer:start"); const result = yield* source; retained = result; log.push("outer:completion"); return result;
    }
    const iterator = outer(); let step = await iterator.next();
    while (!step.done) { await take(step.value); step = await iterator.next(); }
    log.push("after"); const expected = ["outer:start", "iterator"];
    for (let index = 0; index < input.length; index++) expected.push("next:" + index, "promise", "body:" + input[index]);
    expected.push("next:" + input.length, "outer:completion", "after");
    assert.compareArray(log, expected); assert.compareArray(values, input);
    assert.sameValue(retained, promise); assert.sameValue(retained instanceof Promise, true);
    assert.sameValue(step.value, token); assert.sameValue(step.done, true);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
