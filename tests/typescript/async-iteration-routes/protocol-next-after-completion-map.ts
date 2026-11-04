/*---
description: "A Map-held async generator returns fresh completed results after its return value is consumed; node never resumes the body again."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-errors, ts-type-aliases, ts-utility-types, ts-unknown, ts-map-set, ts-null-undefined, ts-async-generators, ts-generators]
flags: [async]
---*/
// A Map-held async generator returns fresh completed results after its return value is consumed; node never resumes the body again.
const log: string[] = [];
type Cursor = Pick<AsyncGenerator<number, number | undefined, unknown>, "next">;
async function* make(input: number): AsyncGenerator<number, number | undefined, unknown> { log.push("start"); yield input; log.push("resume"); return input + 1; }
async function run(): Promise<void> {
  for (const input of [3, 7]) {
    log.length = 0; const table: Map<string, Cursor> = new Map([["source", make(input)]]), source = table.get("source"); if (source === undefined) throw new Test262Error("missing source");
    const first = await source.next(), end = await source.next(), after = await source.next(), again = await source.next(); log.push("after");
    assert.compareArray([first.done, end.done, after.done, again.done], [false, true, true, true]); assert.compareArray([first.value, end.value, after.value, again.value], [input, input + 1, undefined, undefined]);
    assert.sameValue(first === end, false); assert.sameValue(end === after, false); assert.sameValue(after === again, false);
    assert.compareArray(log, ["start", "resume", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
