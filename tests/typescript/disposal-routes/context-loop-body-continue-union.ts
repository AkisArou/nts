/*---
description: Continuing a loop disposes resources narrowed from a union before the following iteration.
features: [ts-disposal-route-loops-generators-functions, ts-using, ts-iteration, ts-unions, ts-narrowing, ts-arrays]
---*/
// Resources: union of Disposable and an absent-value record; node disposes before continue while skipping null and undefined.
type ResourceChoice = Disposable | { absent: null | undefined };
for (const shape of [0, 1, 3, 5]) for (const skip of [0, 1]) {
  const log: unknown[] = ["before"];
  function make(): Disposable { return { [Symbol.dispose](): void { log.push("dispose", this); } }; }
  const first = make(), second = make(), third = make();
  const choices: ResourceChoice[] = shape === 0 ? [] : shape === 1 ? [first] : shape === 3 ? [first, second, third] : [{ absent: null }, first, { absent: undefined }, second, third];
  function run(values: ResourceChoice[]): void {
    let index = 0;
    for (const selected of values) {
      const resource = "absent" in selected ? selected.absent : selected;
      log.push("iteration", index); using held = resource; log.push("body", resource);
      if (index++ % 2 === skip) { log.push("continue"); continue; } log.push("last");
    }
  }
  run(choices); log.push("after");
  const expected: unknown[] = ["before"];
  for (let index = 0; index < choices.length; index++) { const selected = choices[index]; const resource = "absent" in selected ? selected.absent : selected;
    expected.push("iteration", index, "body", resource, index % 2 === skip ? "continue" : "last");
    if (resource !== null && resource !== undefined) expected.push("dispose", resource); }
  expected.push("after");
  assert.compareArray(log, expected);
}
