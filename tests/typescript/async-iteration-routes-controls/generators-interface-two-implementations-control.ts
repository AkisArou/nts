/*---
description: "Control: One interface dispatches to a generator or a manual iterator; node preserves each complete creation and step history while delivering the same values."
features: [ts-async-iteration-routes, ts-async-iteration-route-generators, ts-async, ts-generators, ts-iteration, ts-functions, ts-arrays, ts-interfaces, ts-class, ts-readonly, ts-symbols, ts-objects, ts-numbers]
flags: [async]
---*/
// Synchronous control: One interface dispatches to a generator or a manual iterator; node preserves each complete creation and step history while delivering the same values.
const log: string[] = [];
interface Source { values(count: number): Iterable<number>; }
class Generated implements Source {
  *values(count: number): Generator<number, void, undefined> {
    log.push("generator:start");
    for (let index = 0; index < count; index++) { log.push("generator:yield:" + index); yield index + 2; log.push("generator:resume:" + index); }
    log.push("generator:finish");
  }
}
class Manual implements Source {
  values(count: number): Iterable<number> {
    log.push("manual:create");
    return { [Symbol.iterator]() {
      log.push("manual:iterator"); let index = 0;
      return { next(): IteratorResult<number, undefined> {
        log.push("manual:next:" + index);
        if (index === count) return { value: undefined, done: true };
        return { value: index++ + 2, done: false };
      } };
    } };
  }
}
async function main(): Promise<void> {
  const owners: readonly Source[] = [new Generated(), new Manual()];
  for (const count of [0, 1, 3]) for (let which = 0; which < owners.length; which++) {
    log.length = 0; const source = owners[which].values(count), seen: number[] = []; log.push("created");
    for (const pending of source) { const value = await pending; log.push("loop:" + seen.length); seen.push(value); }
    log.push("after"); const expected = which === 0 ? ["created", "generator:start"] : ["manual:create", "created", "manual:iterator"], wanted: number[] = [];
    for (let index = 0; index < count; index++) {
      if (which === 0) expected.push("generator:yield:" + index, "loop:" + index, "generator:resume:" + index);
      else expected.push("manual:next:" + index, "loop:" + index);
      wanted.push(index + 2);
    }
    expected.push(which === 0 ? "generator:finish" : "manual:next:" + count, "after");
    assert.compareArray(log, expected); assert.compareArray(seen, wanted); assert.sameValue(seen.length, count);
  }
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
