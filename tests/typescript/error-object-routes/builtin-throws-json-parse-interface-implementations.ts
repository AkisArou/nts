/*---
description: "Direct and assembled malformed JSON inputs throw SyntaxError through two operation implementations."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-numbers]
flags: [module]
---*/
// An Operation interface dispatches to two concrete class implementations with declared fields. Each caught value has the specified standard class and Error brand; node prints builtin-throws-json-parse-interface-implementations:ok.
const log: string[] = [];
interface ThrowOperation { run(): unknown; }
class DirectParser implements ThrowOperation {
  text: string; constructor(text: string) { this.text = text; }
  run(): unknown { log.push(this.text); return JSON.parse(this.text); }
}
class JoinedParser implements ThrowOperation {
  left: string; right: string; constructor(left: string, right: string) { this.left = left; this.right = right; }
  run(): unknown { const text: string = this.left + this.right; log.push(text); return JSON.parse(text); }
}
const operations: ThrowOperation[] = [new DirectParser("{"), new JoinedParser("[", ","), new DirectParser("["), new JoinedParser('{"a":', "}")];
for (let index = 0; index < operations.length; index++) {
  let caught: unknown; let threw: boolean = false;
  try { operations[index].run(); } catch (error: unknown) { caught = error; threw = true; }
  assert.sameValue(threw, true);
  assert.sameValue(caught instanceof SyntaxError, true);
  assert.sameValue(caught instanceof Error, true);
  assert.sameValue(Error.isError(caught), true);
  if (caught instanceof Error) log.push(caught.name);
}
assert.compareArray(log, ["{", "SyntaxError", "[,", "SyntaxError", "[", "SyntaxError", "{\"a\":}", "SyntaxError"]);
console.log("builtin-throws-json-parse-interface-implementations:ok");
