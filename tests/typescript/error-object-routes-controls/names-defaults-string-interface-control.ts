/*---
description: "String conversion uses default name and message through either reader implementation through two interface implementations."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-declare-field, ts-this, ts-interfaces, ts-unions, ts-arrays, ts-readonly, ts-tuples, ts-iteration]
flags: [module]
---*/
// String conversion uses default name and message through either reader implementation; route: two interface implementations.
// Node prints: names-defaults-string-interface:ok
let faultIndex: number = 0;
class Fault {
  name: string | undefined; message: string | undefined; text: string;
  constructor(name: string | undefined, message: string | undefined) { this.name = name; this.message = message; this.text = ["Error", "Error: m", "Custom", ""][faultIndex++]; }
  toString(): string { return this.text; }
}
type Parts = Fault; const Parts = Fault;
const rows: readonly (readonly [string | undefined, string | undefined, string])[] = [[undefined, undefined, "Error"], [undefined, "m", "Error: m"], ["Custom", undefined, "Custom"], ["", undefined, ""]];
interface Reader { read(value: Parts): string; }
class DirectReader implements Reader { read(value: Parts): string { return value.text; } }
class HeldReader implements Reader { value: Parts | undefined; read(value: Parts): string { this.value = value; return this.value.text; } }
const readers: readonly Reader[] = [new DirectReader(), new HeldReader()];
for (let index = 0; index < rows.length; index++) {
  const [label, message, expected] = rows[index]; const value: Parts = new Parts(label, message);
  assert.sameValue(readers[index % 2].read(value), expected);
}
console.log("names-defaults-string-interface:ok");
