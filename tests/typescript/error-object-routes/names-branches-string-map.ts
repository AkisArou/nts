/*---
description: "String conversion selects every empty or present name and message branch through guarded Map.get."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-map-set, ts-narrowing]
flags: [module]
---*/
// String conversion selects every empty or present name and message branch; route: guarded Map.get.
// Node prints: names-branches-string-map:ok
const rows: readonly (readonly [string, string, string])[] = [["Error", "m", "Error: m"], ["", "m", "m"], ["Custom", "", "Custom"], ["", "", ""]];
const held: Map<string, Error> = new Map();
function read(key: string): string { const error = held.get(key); if (error === undefined) throw "missing"; return String(error); }
for (const [label, message, expected] of rows) {
  const error: Error = new Error(message); error.name = label; held.set("current", error);
  assert.sameValue(read("current"), expected);
}
console.log("names-branches-string-map:ok");
