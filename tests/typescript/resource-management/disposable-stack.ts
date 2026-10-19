/*---
description: A DisposableStack gathers resources and callbacks and disposes them in reverse when it is disposed.
features: [ts-using]
---*/
const log: string[] = [];
{
  using stack = new DisposableStack();
  stack.defer(() => log.push("deferred"));
  const file = stack.use({ name: "f", [Symbol.dispose]: () => log.push("file") });
  stack.adopt(7, (value) => log.push(`adopted ${value}`));
  log.push(`using ${file.name}`);
}
assert.compareArray(log, ["using f", "adopted 7", "file", "deferred"]);
const moved = new DisposableStack();
moved.defer(() => log.push("moved"));
const owner = moved.move();
assert.sameValue(moved.disposed, true);
owner.dispose();
assert.sameValue(log[log.length - 1], "moved");
