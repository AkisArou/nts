/*---
description: "Control: Sealed and nonextensible alias additions retain TypeError classification beside SyntaxError through a generic helper."
features: [ts-error-object-routes, ts-error-object-route-builtin-throws, ts-errors, ts-unknown, ts-instanceof, ts-narrowing, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-generics, ts-generic-constraints, ts-function-types, ts-arrow-functions, ts-closures, ts-optional-parameters, ts-numbers, ts-interfaces, ts-objects, ts-optional-properties, ts-spread]
flags: [module]
---*/
// A generic expectThrow helper carries two explicit error type arguments and typed operation callbacks; each tested operation is replaced by an explicit throw of the same class. Node prints builtin-throws-sealed-nonextensible-generic-expect-throw:ok.
function refuseAdd(target: ThrowCell, next: number): never { throw new TypeError(); }
function refuseParse(text: string): never { throw new SyntaxError(); }
const log: string[] = [];
function expectThrow<E extends Error>(expected: new (message?: string) => E, operation: () => unknown): void {
  let caught: unknown; let threw: boolean = false;
  try { operation(); } catch (error: unknown) { caught = error; threw = true; }
  assert.sameValue(threw, true);
  assert.sameValue(caught instanceof expected, true);
  assert.sameValue(caught instanceof Error, true);
  assert.sameValue(Error.isError(caught), true);
  if (caught instanceof expected) log.push(caught.name);
}
interface ThrowCell { value: number; extra?: number; }
const sealed: ThrowCell[] = [{ value: 2 }, { value: -3 }], locked: ThrowCell[] = [{ value: 5 }, { value: 0 }];
for (const target of sealed) {
  const alias: ThrowCell = target, next: number = target.value + 10; Object.seal(target);
  expectThrow<TypeError>(TypeError, () => { log.push("seal:" + alias.value + ":" + next); refuseAdd(alias, next); });
}
for (const target of locked) {
  const alias: ThrowCell = target, next: number = target.value + 20; Object.preventExtensions(target);
  expectThrow<TypeError>(TypeError, () => { log.push("prevent:" + alias.value + ":" + next); refuseAdd(alias, next); });
}
for (const text of ["{", "["]) expectThrow<SyntaxError>(SyntaxError, (): unknown => { log.push("json:" + text); return refuseParse(text); });
assert.compareArray(sealed.map((target) => target.value), [2, -3]); assert.compareArray(locked.map((target) => target.value), [5, 0]);
for (const target of [...sealed, ...locked]) { assert.sameValue(Object.hasOwn(target, "extra"), false); assert.compareArray(Object.keys(target), ["value"]); }
assert.compareArray(log, ["seal:2:12", "TypeError", "seal:-3:7", "TypeError", "prevent:5:25", "TypeError", "prevent:0:20", "TypeError", "json:{", "SyntaxError", "json:[", "SyntaxError"]);
console.log("builtin-throws-sealed-nonextensible-generic-expect-throw:ok");
