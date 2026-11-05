/*---
description: "find reports original values, indices and receiver until its first match or exhaustion through an array union narrowed by its discriminant. (control)"
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-unions, ts-narrowing, ts-type-aliases, ts-arrow-functions, ts-null-undefined]
---*/
function localFind<T>(items: T[], callback: (value: T, index: number, owner: T[]) => boolean): T | undefined {
  for (let index = 0; index < items.length; index++) if (callback(items[index], index, items)) return items[index];
  return undefined;
}
// find reports original values, indices and receiver until its first match or exhaustion; route: an array union narrowed by its discriminant.
// Node prints: callbacks-find-discriminant:ok
type FindSource = { kind: "ready"; items: number[] } | { kind: "empty"; reason: string };
function run(source: FindSource, expected: number | undefined, visits: string[]): void {
  if (source.kind !== "ready") return;
  const items = source.items, log: string[] = [];
  const callback = (value: number, index: number, owner: number[]): boolean => {
    log[log.length] = index + ":" + value + ":" + (owner === items);
    return value > 10;
  };
  const result = localFind(items, callback);
  assert.sameValue(result, expected); assert.compareArray(log, visits);
}
run({ kind: "ready", items: [3, 12, 18] }, 12, ["0:3:true", "1:12:true"]);
run({ kind: "ready", items: [4, 1] }, undefined, ["0:4:true", "1:1:true"]);
run({ kind: "ready", items: [] }, undefined, []);
run({ kind: "empty", reason: "none" }, undefined, []);
console.log("callbacks-find-discriminant:ok");
