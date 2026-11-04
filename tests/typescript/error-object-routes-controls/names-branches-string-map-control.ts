/*---
description: "String conversion selects every empty or present name and message branch through guarded Map.get."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-map-set, ts-narrowing]
flags: [module]
---*/
// String conversion selects every empty or present name and message branch; route: guarded Map.get.
// Node prints: names-branches-string-map:ok
let faultIndex: number = 0;
class Fault {
  name: string = "Error"; message: string; text: string;
  constructor(message: string) { this.message = message; this.text = ["Error: m", "m", "Custom", ""][faultIndex++]; }
  toString(): string { return this.text; }
}
const rows: readonly (readonly [string, string, string])[] = [["Error", "m", "Error: m"], ["", "m", "m"], ["Custom", "", "Custom"], ["", "", ""]];
const held: Map<string, Fault> = new Map();
function read(key: string): string { const error = held.get(key); if (error === undefined) throw "missing"; return error.text; }
for (const [label, message, expected] of rows) {
  const error: Fault = new Fault(message); error.name = label; held.set("current", error);
  assert.sameValue(read("current"), expected);
}
console.log("names-branches-string-map:ok");
