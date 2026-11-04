/*---
description: "Breaking for-await over a Map-held sync generator; node closes the sync iterator once before continuing and leaves it finished."
features: [ts-async-iteration-routes, ts-async-iteration-route-delegation, ts-async, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-async-generators, ts-generators, ts-map-set, ts-objects, ts-unions, ts-narrowing, ts-errors, ts-arrow-functions]
flags: [async]
---*/
// Breaking for-await over a Map-held sync generator; node closes the sync iterator once before continuing and leaves it finished.
const log: string[] = [];
function* make(input: number[], state: { closed: number }): Generator<number | Promise<number>, void, void> {
  try { for (const value of input) { log.push("yield:" + value); yield Promise.resolve(value); } }
  finally { state.closed++; log.push("finally"); }
}
async function main(): Promise<void> {
  for (const input of [[], [-0], [1, 2, 3]]) for (const limit of [1, 2]) {
    log.length = 0; const state = { closed: 0 }; const sources: Map<string, Generator<number | Promise<number>, void, void>> = new Map([["selected", make(input, state)]]);
    const source = sources.get("selected"); if (!source) throw new Error("source"); const values: number[] = [];
    for await (const value of source) { log.push("body:" + value); values.push(value); if (values.length === limit) break; }
    log.push("after"); const again = source.next(); const expected: string[] = [];
    for (const value of input.slice(0, limit)) expected.push("yield:" + value, "body:" + value); expected.push("finally", "after");
    assert.compareArray(log, expected); assert.compareArray(values, input.slice(0, limit));
    assert.sameValue(state.closed, 1); assert.sameValue(again.done, true); assert.sameValue(again.value, undefined);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
