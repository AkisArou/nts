/*---
description: A tuple with a trailing rest element has fixed leading elements and any number after them.
features: [ts-tuples, ts-tuple-rest]
---*/
type Command = [name: string, ...args: number[]];
function run([name, ...args]: Command): string {
  return `${name}(${args.reduce((a, b) => a + b, 0)})`;
}
assert.sameValue(run(["sum"]), "sum(0)");
assert.sameValue(run(["sum", 1, 2, 3]), "sum(6)");
const command: Command = ["x", 5];
command.push(6);
assert.sameValue(command.length, 3);
