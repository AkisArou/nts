/*---
description: "Message reassignment preserves the live text and distinct standard names in either narrowed arm through a discriminated union of Error and TypeError holders."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-narrowing, ts-objects, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-template-literals]
flags: [module]
---*/
// Message reassignment preserves the live text and distinct standard names in either narrowed arm; route: a discriminated union of Error and TypeError holders.
// Node prints: names-message-update-discriminated-union:ok
let faultIndex: number = 0, updateIndex: number = 0;
const initialFaultRows: readonly (readonly [string, string])[] = [["Error", "Error: initial"], ["TypeError", "TypeError: initial"]];
const updatedFaultTexts: readonly string[] = ["Error: next", "TypeError: next", "Error", "TypeError", "Error: final", "TypeError: final"];
class Fault {
  name: string; message: string; text: string;
  constructor(message: string) { const row = initialFaultRows[faultIndex++]; this.name = row[0]; this.message = message; this.text = row[1]; }
  toString(): string { return this.text; }
}
function updateLiteralText(error: Error): void {
  if (!(error instanceof Fault)) throw "missing model";
  error.text = updatedFaultTexts[updateIndex++];
}
type Routed = { kind: "base"; error: Error } | { kind: "typed"; error: TypeError };
function change(route: Routed, message: string): string {
  if (route.kind === "base") { route.error.message = message; updateLiteralText(route.error); return String(route.error); }
  route.error.message = message; updateLiteralText(route.error); return `${route.error}`;
}
const routes: readonly Routed[] = [{ kind: "base", error: new Fault("initial") }, { kind: "typed", error: new Fault("initial") }];
assert.sameValue(String(routes[0].error), "Error: initial"); assert.sameValue(String(routes[1].error), "TypeError: initial");
const rows: readonly (readonly [string, string, string])[] = [["next", "Error: next", "TypeError: next"], ["", "Error", "TypeError"], ["final", "Error: final", "TypeError: final"]];
for (const [message, baseText, typeText] of rows) {
  for (let index = 0; index < routes.length; index++) {
    const route: Routed = routes[index], text: string = change(route, message);
    assert.sameValue(text, [baseText, typeText][index]); assert.sameValue(String(route.error), [baseText, typeText][index]); assert.sameValue(route.error.message, message);
  }
}
console.log("names-message-update-discriminated-union:ok");
