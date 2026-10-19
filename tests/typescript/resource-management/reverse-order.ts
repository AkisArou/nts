/*---
description: Several `using` declarations in one block are disposed in reverse order of declaration.
features: [ts-using]
---*/
const log: string[] = [];
function resource(label: string): Disposable {
  return { [Symbol.dispose]: () => log.push(label) };
}
function run(): void {
  using first = resource("first");
  using second = resource("second");
  using third = resource("third");
  log.push("body");
}
run();
assert.compareArray(log, ["body", "third", "second", "first"]);
