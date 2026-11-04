/*---
description: "Control: An interface-held generator feeds an object destructuring loop head; node reads id then name before the body and resumes only afterward."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-interfaces, ts-readonly, ts-tuples, ts-destructuring, ts-accessors, ts-numbers, ts-strings]
flags: [async]
---*/
// Synchronous control: An interface-held generator feeds an object destructuring loop head; node reads id then name before the body and resumes only afterward.
const log: string[] = [];
interface Row { readonly id: number; readonly name: string; }
interface Feed { source: Iterable<Row>; }
function* produce(values: readonly (readonly [number, string])[]): Generator<Row, void, undefined> {
  for (let index = 0; index < values.length; index++) {
    const [id, name] = values[index];
    const row: Row = { get id() { log.push("id:" + index); return id; }, get name() { log.push("name:" + index); return name; } };
    log.push("yield:" + index); yield row; log.push("resume:" + index);
  }
  log.push("finish");
}
async function main(): Promise<void> {
  const rows: [number, string][][] = [[], [[-0, ""]], [[2, "a"], [NaN, "é"], [7, "last"]]];
  for (const values of rows) {
    log.length = 0; const feed: Feed = { source: produce(values) }, ids: number[] = [], names: string[] = [];
    for (const pending of feed.source) { const { id, name } = await pending; log.push("loop:" + ids.length); ids.push(id); names.push(name); }
    log.push("after"); const expected: string[] = [], wantedIds: number[] = [], wantedNames: string[] = [];
    for (let index = 0; index < values.length; index++) {
      expected.push("yield:" + index, "id:" + index, "name:" + index, "loop:" + index, "resume:" + index);
      wantedIds.push(values[index][0]); wantedNames.push(values[index][1]);
    }
    expected.push("finish", "after");
    assert.compareArray(log, expected); assert.compareArray(ids, wantedIds); assert.compareArray(names, wantedNames);
    assert.sameValue(ids.length, values.length);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
