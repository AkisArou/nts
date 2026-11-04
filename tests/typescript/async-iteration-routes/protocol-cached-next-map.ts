/*---
description: "The Map-held custom async source captures next once; node keeps calling the original method after the loop replaces the property."
features: [ts-async-iteration-routes, ts-async-iteration-route-protocol, ts-async, ts-async-generators, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-class, ts-class-fields, ts-this, ts-symbols, ts-generics, ts-numbers, ts-strings, ts-errors, ts-map-set, ts-accessors, ts-closures, ts-arrow-functions, ts-null-undefined]
flags: [async]
---*/
// The Map-held custom async source captures next once; node keeps calling the original method after the loop replaces the property.
const log: string[] = [];
class Cursor {
  index = 0; input: number; action: () => Promise<IteratorResult<number, void>>;
  constructor(input: number) { this.input = input; this.action = async () => { log.push("next:" + this.index); return this.index < 2 ? { value: this.input + this.index++, done: false } : { value: undefined, done: true }; }; }
  get next(): () => Promise<IteratorResult<number, void>> { log.push("get:next"); return this.action; }
  set next(value: () => Promise<IteratorResult<number, void>>) { log.push("set:next"); this.action = value; }
}
class Source implements AsyncIterable<number> {
  cursor: Cursor; constructor(cursor: Cursor) { this.cursor = cursor; }
  [Symbol.asyncIterator](): Cursor { log.push("iterator"); return this.cursor; }
}
async function run(): Promise<void> {
  for (const input of [2, 7]) {
    log.length = 0; const cursor = new Cursor(input), table: Map<string, Source> = new Map([["source", new Source(cursor)]]);
    const source = table.get("source"); if (source === undefined) throw new Test262Error("missing source"); const seen: number[] = [];
    for await (const value of source) { log.push("body"); seen.push(value); if (seen.length === 1) cursor.next = async () => { log.push("replacement"); return { value: undefined, done: true }; }; }
    log.push("after"); assert.compareArray(seen, [input, input + 1]); assert.sameValue(cursor.index, 2);
    assert.compareArray(log, ["iterator", "get:next", "next:0", "body", "set:next", "next:1", "body", "next:2", "after"]);
  }
}
run().then(() => $DONE(), (error: unknown) => $DONE(error));
