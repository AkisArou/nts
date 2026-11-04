/*---
description: "Control for regexp-search-no-species-tuple; RegExp search never reads species and restores the exact original lastIndex through a typed tuple."
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-builtin-subclass, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-override, ts-static, ts-symbols, ts-accessors, ts-this, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-objects, ts-tuples, ts-rest-parameters, ts-instanceof, ts-type-aliases, ts-unions, ts-null-undefined, ts-errors]
---*/
// search receives a RegExp/string tuple; node calls original exec at positive zero, restores negative zero or a fractional cursor exactly, and never touches species. The control uses explicit construction and exec steps.
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
type Input = [RegExp, string];
function run(input: Input): number { const rx = input[0], previous = rx.lastIndex; if (!Object.is(previous, 0)) rx.lastIndex = 0; const hit = rx.exec(input[1]); if (!Object.is(rx.lastIndex, previous)) rx.lastIndex = previous; return hit === null ? -1 : hit.index; }
const rows: [string, number, number, string | null][] = [["baba", 1, 2, "a"], ["bbb", -1, 0, null], ["", -1, 0, null]];
for (const Type of [Plain, Further]) for (const start of [-0, 3.5]) for (const row of rows) {
  log.length = 0; const input: Input = [new Type("a", "g"), row[0]];
  Object.defineProperty(input[0], "constructor", { get() { log.push("constructor", this); throw new Error("constructor read"); } });
  input[0].lastIndex = start; same(run(input), row[1]); same(input[0].lastIndex, start);
  same(Object.getPrototypeOf(input[0]), Type.prototype); same(input[0] instanceof Plain, true); same(input[0] instanceof Further, Type === Further); if (input[0] instanceof Plain) same(input[0].tag, "plain"); exact(Reflect.ownKeys(input[0]), ["lastIndex", "tag", "constructor"]);
  exact(log, ["ctor", input[0], Type, 2, "a", "g", "exec", input[0], row[0], 0, row[2], row[1], row[3]]);
}
