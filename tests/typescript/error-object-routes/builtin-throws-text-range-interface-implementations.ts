/*---
description: "Invalid repetition, normalization and code-point arguments throw RangeError through two operation implementations."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-numbers, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-objects]
flags: [module]
---*/
// An Operation interface dispatches to two concrete class implementations with declared fields. Each caught value has the specified standard class and Error brand; node prints builtin-throws-text-range-interface-implementations:ok.
const log: string[] = [];
interface ThrowOperation { run(): unknown; }
type TextInput = { kind: "repeat"; text: string; count: number } | { kind: "normalize"; text: string; form: string };
class TextTask implements ThrowOperation {
  input: TextInput; constructor(input: TextInput) { this.input = input; }
  run(): unknown {
    const input: TextInput = this.input;
    if (input.kind === "repeat") { log.push("repeat:" + input.text + ":" + input.count); return input.text.repeat(input.count); }
    log.push("normalize:" + input.text + ":" + input.form); return input.text.normalize(input.form);
  }
}
class PointTask implements ThrowOperation {
  value: number; constructor(value: number) { this.value = value; }
  run(): unknown { log.push("point:" + this.value); return String.fromCodePoint(this.value); }
}
const operations: ThrowOperation[] = [
  new TextTask({ kind: "repeat", text: "a", count: -1 }), new PointTask(-1), new TextTask({ kind: "normalize", text: "a", form: "NFX" }),
  new TextTask({ kind: "repeat", text: "", count: -2 }), new PointTask(1114112), new TextTask({ kind: "normalize", text: "", form: "nfc" })
];
for (let index = 0; index < operations.length; index++) {
  let caught: unknown; let threw: boolean = false;
  try { operations[index].run(); } catch (error: unknown) { caught = error; threw = true; }
  assert.sameValue(threw, true);
  assert.sameValue(caught instanceof RangeError, true);
  assert.sameValue(caught instanceof Error, true);
  assert.sameValue(Error.isError(caught), true);
  if (caught instanceof Error) log.push(caught.name);
}
assert.compareArray(log, ["repeat:a:-1", "RangeError", "point:-1", "RangeError", "normalize:a:NFX", "RangeError", "repeat::-2", "RangeError", "point:1114112", "RangeError", "normalize::nfc", "RangeError"]);
console.log("builtin-throws-text-range-interface-implementations:ok");
