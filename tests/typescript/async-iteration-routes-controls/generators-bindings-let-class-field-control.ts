/*---
description: "Control: A class-held generator feeds mutable loop bindings; node keeps each saved reader and writer attached to its own let binding."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-class, ts-class-fields, ts-this, ts-interfaces, ts-readonly, ts-numbers, ts-closures, ts-function-types, ts-arrow-functions]
flags: [async]
---*/
// Synchronous control: A class-held generator feeds mutable loop bindings; node keeps each saved reader and writer attached to its own let binding.
const log: string[] = [];
interface Saved { read(): number; write(value: number): void; }
class Input { source: Iterable<number>; constructor(source: Iterable<number>) { log.push("construct"); this.source = source; } }
function* produce(values: readonly number[]): Generator<number, void, undefined> {
  for (let index = 0; index < values.length; index++) { log.push("yield:" + index); yield values[index]; log.push("resume:" + index); }
  log.push("finish");
}
async function consume(input: Input): Promise<number[]> {
  const saved: Saved[] = [];
  for (const pending of input.source) { let value = await pending;
    const index = saved.length; log.push("loop:" + index); value += 100;
    saved.push({ read: () => { log.push("read:" + index); return value; }, write: next => { log.push("write:" + index); value = next; } });
  }
  log.push("after"); if (saved.length > 0) saved[0].write(-0);
  const captured: number[] = []; for (const entry of saved) captured.push(entry.read());
  log.push("done"); return captured;
}
async function main(): Promise<void> {
  const rows: number[][] = [[], [2], [3, 5, 7]];
  for (const values of rows) {
    log.length = 0; const input = new Input(produce(values)), captured = await consume(input), expected = ["construct"], wanted: number[] = [];
    for (let index = 0; index < values.length; index++) { expected.push("yield:" + index, "loop:" + index, "resume:" + index); wanted.push(index === 0 ? -0 : values[index] + 100); }
    expected.push("finish", "after"); if (values.length > 0) expected.push("write:0");
    for (let index = 0; index < values.length; index++) expected.push("read:" + index); expected.push("done");
    assert.compareArray(log, expected); assert.compareArray(captured, wanted); assert.sameValue(captured.length, values.length);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
