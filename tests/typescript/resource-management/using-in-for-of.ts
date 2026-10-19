/*---
description: A `using` declaration in a for-of head disposes each element at the end of its iteration.
features: [ts-using, ts-iteration]
---*/
const log: string[] = [];
function* connections(): Generator<Disposable & { id: number }> {
  for (let id = 1; id <= 2; id++) yield { id, [Symbol.dispose]: () => log.push(`close ${id}`) };
}
for (using connection of connections()) {
  log.push(`use ${connection.id}`);
}
assert.compareArray(log, ["use 1", "close 1", "use 2", "close 2"]);
