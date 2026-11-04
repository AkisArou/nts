/*---
description: "Two generators from one function cross a typed tuple; node keeps independent locals while their steps alternate."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-async-generators, ts-tuples, ts-numbers, ts-unions, ts-null-undefined]
flags: [async]
---*/
// Two generators from one function cross a typed tuple; node keeps independent locals while their steps alternate.
const log: string[] = [];
async function* sequence(label: string, start: number): AsyncGenerator<number, number, undefined> {
  let current = start;
  for (let index = 0; index < 2; index++) { log.push(label + ":yield:" + index); yield current++; log.push(label + ":resume:" + index); }
  log.push(label + ":finish"); return current;
}
async function main(): Promise<void> {
  for (const start of [2, 10]) {
    log.length = 0;
    const cursors: [AsyncGenerator<number, number, undefined>, AsyncGenerator<number, number, undefined>] = [sequence("a", start), sequence("b", start + 20)];
    log.push("created"); const values: number[] = [], dones: (boolean | undefined)[] = [];
    for (let turn = 0; turn < 3; turn++) {
      const a = await cursors[0].next(); log.push("take:a:" + turn); values.push(a.value); dones.push(a.done);
      const b = await cursors[1].next(); log.push("take:b:" + turn); values.push(b.value); dones.push(b.done);
    }
    log.push("after");
    assert.compareArray(log, ["created", "a:yield:0", "take:a:0", "b:yield:0", "take:b:0", "a:resume:0", "a:yield:1", "take:a:1", "b:resume:0", "b:yield:1", "take:b:1", "a:resume:1", "a:finish", "take:a:2", "b:resume:1", "b:finish", "take:b:2", "after"]);
    assert.compareArray(values, [start, start + 20, start + 1, start + 21, start + 2, start + 22]);
    assert.compareArray(dones, [false, false, false, false, true, true]);
    assert.sameValue(cursors[0] === cursors[1], false);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
