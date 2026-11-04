/*---
description: "Empty reductions and frozen, sealed or nonextensible alias writes throw TypeError through two operation implementations."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-numbers, ts-unions, ts-objects, ts-optional-properties, ts-arrow-functions, ts-function-types, ts-null-undefined]
flags: [module]
---*/
// An Operation interface dispatches to two concrete class implementations with declared fields. Each caught value has the specified standard class and Error brand; node prints builtin-throws-type-failures-interface-implementations:ok.
const log: string[] = [];
interface ThrowOperation { run(): unknown; }
interface ThrowCell { value: number; extra?: number; }
class EmptyReduction implements ThrowOperation {
  values: number[]; constructor(values: number[]) { this.values = values; }
  run(): unknown { log.push("reduce:" + this.values.length); return this.values.reduce((left: number, right: number): number => left + right); }
}
class IntegrityMutation implements ThrowOperation {
  target: ThrowCell; mode: "freeze" | "seal" | "prevent"; next: number;
  constructor(target: ThrowCell, mode: "freeze" | "seal" | "prevent", next: number) {
    this.target = target; this.mode = mode; this.next = next;
    if (mode === "freeze") Object.freeze(target); else if (mode === "seal") Object.seal(target); else Object.preventExtensions(target);
  }
  run(): unknown {
    const alias: ThrowCell = this.target; log.push(this.mode + ":" + alias.value + ":" + this.next);
    if (this.mode === "freeze") { alias.value = this.next; } else { alias.extra = this.next; }
    return undefined;
  }
}
const targets: ThrowCell[] = [{ value: 4 }, { value: 5 }, { value: 6 }];
const operations: ThrowOperation[] = [new EmptyReduction([]), new IntegrityMutation(targets[0], "freeze", 11), new EmptyReduction([]), new IntegrityMutation(targets[1], "seal", 12), new IntegrityMutation(targets[2], "prevent", 13)];
for (let index = 0; index < operations.length; index++) {
  let caught: unknown; let threw: boolean = false;
  try { operations[index].run(); } catch (error: unknown) { caught = error; threw = true; }
  assert.sameValue(threw, true);
  assert.sameValue(caught instanceof TypeError, true);
  assert.sameValue(caught instanceof Error, true);
  assert.sameValue(Error.isError(caught), true);
  if (caught instanceof Error) log.push(caught.name);
}
assert.compareArray(targets.map((target) => target.value), [4, 5, 6]);
for (const target of targets) { assert.sameValue(Object.hasOwn(target, "extra"), false); assert.compareArray(Object.keys(target), ["value"]); }
assert.compareArray(log, ["reduce:0", "TypeError", "freeze:4:11", "TypeError", "reduce:0", "TypeError", "seal:5:12", "TypeError", "prevent:6:13", "TypeError"]);
console.log("builtin-throws-type-failures-interface-implementations:ok");
