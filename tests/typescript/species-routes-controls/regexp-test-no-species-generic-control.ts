/*---
description: "Control for regexp-test-no-species-generic; RegExp test never reads species through a generic base route and calls the original exec exactly once."
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-builtin-subclass, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-override, ts-static, ts-symbols, ts-accessors, ts-this, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-objects, ts-tuples, ts-rest-parameters, ts-instanceof, ts-generics, ts-generic-constraints, ts-unions, ts-null-undefined, ts-errors]
---*/
// test receives a generic RegExp parameter; node executes the original subclass once, respects its cursor, and never consults its species override. The control uses explicit construction and exec steps.
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
function run<T extends RegExp>(rx: T, text: string): boolean { return rx.exec(text) !== null; }
const rows: [number, boolean, number, number, string | null][] = [[0, true, 1, 0, "a"], [2, true, 3, 2, "a"], [5, false, 0, -1, null], [NaN, true, 1, 0, "a"]];
for (const Type of [Plain, Further]) for (const row of rows) {
  log.length = 0; const rx: RegExp = new Type("a", "g");
  Object.defineProperty(rx, "constructor", { get() { log.push("constructor", this); throw new Error("constructor read"); } });
  rx.lastIndex = row[0]; same(run(rx, "ababa"), row[1]); same(rx.lastIndex, row[2]);
  same(Object.getPrototypeOf(rx), Type.prototype); same(rx instanceof Plain, true); same(rx instanceof Further, Type === Further); if (rx instanceof Plain) same(rx.tag, "plain"); exact(Reflect.ownKeys(rx), ["lastIndex", "tag", "constructor"]);
  exact(log, ["ctor", rx, Type, 2, "a", "g", "exec", rx, "ababa", row[0], row[2], row[3], row[4]]);
}
