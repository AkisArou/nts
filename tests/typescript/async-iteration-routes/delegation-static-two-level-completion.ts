/*---
description: "Two async delegation levels through a static consumer; node keeps the middle generator promised completion object after the inner array completes."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-generators, ts-class, ts-static, ts-interfaces, ts-objects, ts-readonly, ts-unions, ts-typeof-operator, ts-arrow-functions]
flags: [async]
---*/
// Two async delegation levels through a static consumer; node keeps the middle generator promised completion object after the inner array completes.
const log: string[] = [];
interface Token { id: number; }
class Collector {
  static async collect(input: readonly (number | Promise<number>)[], token: Token): Promise<{ values: number[]; result: unknown }> {
    const values: number[] = []; let result: unknown = undefined;
    async function* middle(): AsyncIterableIterator<number, Token, void> {
      log.push("middle:start"); const done = yield* input; log.push("middle:complete:" + done); return Promise.resolve(token);
    }
    async function* outer(): AsyncIterableIterator<number, void, void> {
      log.push("outer:start"); result = yield* middle(); log.push("outer:complete");
    }
    for await (const value of outer()) { log.push("body:" + value); values.push(value); }
    log.push("after"); return { values, result };
  }
}
async function main(): Promise<void> {
  for (const input of [[], [-0], [1, 2, NaN]]) {
    log.length = 0; const token: Token = { id: input.length }; const source: (number | Promise<number>)[] = [];
    for (const value of input) source.push(Promise.resolve(value));
    const result = await Collector.collect(source, token); const expected = ["outer:start", "middle:start"];
    for (const value of input) expected.push("body:" + value); expected.push("middle:complete:undefined", "outer:complete", "after");
    assert.compareArray(log, expected); assert.compareArray(result.values, input);
    assert.sameValue(result.result, token); assert.sameValue(typeof result.result, "object");
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
