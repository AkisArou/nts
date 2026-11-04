/*---
description: "Control: An interface-held generator feeds const loop bindings; node keeps a distinct captured value and reader function for each completed step."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-interfaces, ts-readonly, ts-numbers, ts-closures, ts-function-types, ts-arrow-functions]
flags: [async]
---*/
// Synchronous control: An interface-held generator feeds const loop bindings; node keeps a distinct captured value and reader function for each completed step.
const log: string[] = [];
interface Input { source: Iterable<number>; }
function* produce(values: readonly number[]): Generator<number, void, undefined> {
  for (let index = 0; index < values.length; index++) { log.push("yield:" + index); yield values[index]; log.push("resume:" + index); }
  log.push("finish");
}
async function consume(input: Input): Promise<number[]> {
  const readers: (() => number)[] = [];
  for (const pending of input.source) { const value = await pending;
    const index = readers.length; log.push("loop:" + index);
    readers.push(() => { log.push("read:" + index); return value; });
  }
  log.push("after"); const captured: number[] = [];
  for (const read of readers) captured.push(read());
  for (let index = 0; index < readers.length; index++) assert.sameValue(readers[index] === readers[0], index === 0);
  log.push("done"); return captured;
}
async function main(): Promise<void> {
  const rows: number[][] = [[], [-0], [2, NaN, 7]];
  for (const values of rows) {
    log.length = 0; const input: Input = { source: produce(values) }, captured = await consume(input), expected: string[] = [];
    for (let index = 0; index < values.length; index++) expected.push("yield:" + index, "loop:" + index, "resume:" + index);
    expected.push("finish", "after"); for (let index = 0; index < values.length; index++) expected.push("read:" + index); expected.push("done");
    assert.compareArray(log, expected); assert.compareArray(captured, values); assert.sameValue(captured.length, values.length);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
