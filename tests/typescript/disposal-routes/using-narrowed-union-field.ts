/*---
description: A narrowed union selects a nullable Disposable field
features: [ts-disposal-route-using-declarations, ts-using, ts-symbols, ts-unions, ts-narrowing, ts-arrays]
---*/
// A tagged union is narrowed to a nullable Disposable field; node skips absent resources and closes ready ones.
type Choice = { kind: "absent" } | { kind: "ready"; value: Disposable | null | undefined };
type Slot = Disposable | null | undefined;
const samples: (string | null | undefined)[][] = [[], ["one"], ["a", null, "c"], ["a", "b", "c"], [null, undefined, "last"]];
function resource(id: string | null | undefined, log: string[]): Slot {
  if (id === null || id === undefined) return id;
  return { [Symbol.dispose]() { log.push("close:" + id); } };
}
for (const sample of samples) {
  const log: string[] = [];
  const choices: Choice[] = [{ kind: "absent" }, ...sample.map(id => ({ kind: "ready", value: resource(id, log) } satisfies Choice))];
  for (const choice of choices) {
    log.push("before");
    if (choice.kind === "ready") {
      using active = choice.value;
      log.push("ready:last");
    } else log.push("absent");
    log.push("after");
  }
  const expected = ["before", "absent", "after"];
  for (const id of sample) {
    expected.push("before", "ready:last");
    if (id !== null && id !== undefined) expected.push("close:" + id);
    expected.push("after");
  }
  assert.compareArray(log, expected);
}
