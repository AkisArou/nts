/*---
description: "RegExp exec never reads species through a typed instance field and returns exact match arrays."
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-builtin-subclass, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-override, ts-static, ts-symbols, ts-accessors, ts-this, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-objects, ts-tuples, ts-rest-parameters, ts-instanceof, ts-parameter-properties, ts-readonly, ts-unions, ts-null-undefined, ts-errors]
---*/
// exec receives a class field typed RegExp; node returns the original match array and updates only that receiver, without consulting the subclass species override.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
class Plain extends RegExp {
  tag: string = "plain";
  constructor(...args: [string | RegExp, string?]) { super(...args); log.push("ctor", this, new.target, args.length, args[0], args[1]); }
  static override get [Symbol.species](): RegExpConstructor { log.push("species", this); return RegExp; }
  override exec(text: string): RegExpExecArray | null { const before = this.lastIndex, hit = RegExp.prototype.exec.call(this, text); log.push("exec", this, text, before, this.lastIndex, hit === null ? -1 : hit.index, hit === null ? null : hit[0]); return hit; }
}
class Further extends Plain {}
class Holder { constructor(readonly rx: RegExp) {} }
function run(holder: Holder, text: string): RegExpExecArray | null { return holder.rx.exec(text); }
const rows: [number, boolean, number, number, string | null][] = [[0, true, 1, 0, "a"], [2, true, 3, 2, "a"], [5, false, 0, -1, null], [NaN, true, 1, 0, "a"]];
for (const Type of [Plain, Further]) for (const row of rows) {
  log.length = 0; const holder = new Holder(new Type("a", "g"));
  Object.defineProperty(holder.rx, "constructor", { get() { log.push("constructor", this); throw new Error("constructor read"); } });
  holder.rx.lastIndex = row[0]; const result = run(holder, "ababa"); same(result !== null, row[1]); same(holder.rx.lastIndex, row[2]);
  same(Object.getPrototypeOf(holder.rx), Type.prototype); same(holder.rx instanceof Plain, true); same(holder.rx instanceof Further, Type === Further); if (holder.rx instanceof Plain) same(holder.rx.tag, "plain"); exact(Reflect.ownKeys(holder.rx), ["lastIndex", "tag", "constructor"]);
  if (result !== null) { exact(result, ["a"]); same(result.index, row[3]); same(result.input, "ababa"); same(result.groups, undefined); same(Array.isArray(result), true); same(Object.getPrototypeOf(result), Array.prototype); exact(Reflect.ownKeys(result), ["0", "length", "index", "input", "groups"]); }
  exact(log, ["ctor", holder.rx, Type, 2, "a", "g", "exec", holder.rx, "ababa", row[0], row[2], row[3], row[4]]);
}
