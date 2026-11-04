/*---
description: "Control: A readonly array carries empty, one-step and longer generators; node starts each only when its outer walk reaches it and keeps sources independent."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-readonly, ts-numbers, ts-strings]
flags: [async]
---*/
// Synchronous control: A readonly array carries empty, one-step and longer generators; node starts each only when its outer walk reaches it and keeps sources independent.
const log: string[] = [];
function* produce(label: string, base: number, count: number): Generator<number, void, undefined> {
  log.push(label + ":start");
  for (let index = 0; index < count; index++) { log.push(label + ":yield:" + index); yield base + index; log.push(label + ":resume:" + index); }
  log.push(label + ":finish");
}
async function main(): Promise<void> {
  const counts = [0, 1, 3];
  for (const base of [2, 9]) {
    log.length = 0;
    const sources: readonly Iterable<number>[] = [produce("0", base, 0), produce("1", base + 10, 1), produce("2", base + 20, 3)];
    const first = sources[0], seen: number[][] = []; log.push("created");
    for (let which = 0; which < sources.length; which++) {
      log.push("walk:" + which); const values: number[] = [];
      for (const pending of sources[which]) { const value = await pending; log.push(which + ":loop:" + values.length); values.push(value); }
      seen.push(values); log.push("between:" + which);
    }
    log.push("after"); const expected = ["created"], wanted: number[][] = [];
    for (let which = 0; which < counts.length; which++) {
      expected.push("walk:" + which, which + ":start"); const values: number[] = [];
      for (let index = 0; index < counts[which]; index++) {
        expected.push(which + ":yield:" + index, which + ":loop:" + index, which + ":resume:" + index); values.push(base + which * 10 + index);
      }
      wanted.push(values); expected.push(which + ":finish", "between:" + which);
    }
    expected.push("after"); assert.compareArray(log, expected);
    for (let which = 0; which < counts.length; which++) assert.compareArray(seen[which], wanted[which]);
    assert.sameValue(sources[0], first); assert.sameValue(sources.length, 3); assert.sameValue(seen.length, 3);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
