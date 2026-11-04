/*---
description: "Message reassignment changes every later direct conversion including the empty-message branch through private Error field."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-this, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-private-fields]
flags: [module]
---*/
// Message reassignment changes every later direct conversion including the empty-message branch; route: private Error field.
// Node prints: names-message-update-private-field:ok
let faultIndex: number = 0, updateIndex: number = 0;
const initialFaultRows: readonly (readonly [string, string])[] = [["Error", "Error: initial"]];
const updatedFaultTexts: readonly string[] = ["Error: next", "Error", "Error: final"];
class Fault {
  name: string; message: string; text: string;
  constructor(message: string) { const row = initialFaultRows[faultIndex++]; this.name = row[0]; this.message = message; this.text = row[1]; }
  toString(): string { return this.text; }
}
function updateLiteralText(error: Error): void {
  if (!(error instanceof Fault)) throw "missing model";
  error.text = updatedFaultTexts[updateIndex++];
}
class Holder {
  #error: Error; constructor(error: Error) { this.#error = error; }
  change(message: string): string { this.#error.message = message; updateLiteralText(this.#error); return this.#error.toString(); }
  read(): string { return this.#error.toString(); }
  readMessage(): string { return this.#error.message; }
}
const holder: Holder = new Holder(new Fault("initial"));
assert.sameValue(holder.read(), "Error: initial");
const rows: readonly (readonly [string, string])[] = [["next", "Error: next"], ["", "Error"], ["final", "Error: final"]];
for (const [message, expected] of rows) {
  const text: string = holder.change(message);
  assert.sameValue(text, expected); assert.sameValue(holder.read(), expected); assert.sameValue(holder.readMessage(), message);
}
console.log("names-message-update-private-field:ok");
