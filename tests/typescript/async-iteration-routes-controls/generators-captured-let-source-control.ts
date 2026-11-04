/*---
description: "Control: A closure walks a typed let source before and after replacement; node consumes the current generator on each call without retaining the earlier source."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-closures, ts-arrow-functions, ts-function-types, ts-numbers, ts-strings]
flags: [async]
---*/
// Synchronous control: A closure walks a typed let source before and after replacement; node consumes the current generator on each call without retaining the earlier source.
const log: string[] = [];
function* produce(label: string, base: number, count: number): Generator<number, void, undefined> {
  log.push(label + ":start");
  for (let index = 0; index < count; index++) { log.push(label + ":yield:" + index); yield base + index; log.push(label + ":resume:" + index); }
  log.push(label + ":finish");
}
async function main(): Promise<void> {
  for (const base of [2, 9]) for (const count of [0, 1, 3]) {
    log.length = 0; let current: Iterable<number> = produce("first", base, count);
    const walk: () => Promise<number[]> = async () => {
      log.push("walk"); const seen: number[] = [];
      for (const pending of current) { const value = await pending; log.push("loop:" + seen.length); seen.push(value); }
      log.push("after"); return seen;
    };
    log.push("created"); const first = await walk(); log.push("replace"); current = produce("second", base + 10, count);
    const second = await walk(); log.push("done"); const expected = ["created"], wantedFirst: number[] = [], wantedSecond: number[] = [];
    for (const label of ["first", "second"]) {
      if (label === "second") expected.push("replace"); expected.push("walk", label + ":start");
      for (let index = 0; index < count; index++) expected.push(label + ":yield:" + index, "loop:" + index, label + ":resume:" + index);
      expected.push(label + ":finish", "after");
    }
    for (let index = 0; index < count; index++) { wantedFirst.push(base + index); wantedSecond.push(base + 10 + index); }
    expected.push("done");
    assert.compareArray(log, expected); assert.compareArray(first, wantedFirst); assert.compareArray(second, wantedSecond);
    assert.sameValue(first === second, false); assert.sameValue(first.length, count); assert.sameValue(second.length, count);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
