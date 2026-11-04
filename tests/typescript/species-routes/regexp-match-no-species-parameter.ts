/*---
description: "RegExp match never reads a species override through a base parameter and executes the original subclass."
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-builtin-subclass, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-override, ts-static, ts-symbols, ts-accessors, ts-this, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-objects, ts-tuples, ts-rest-parameters, ts-instanceof, ts-type-aliases, ts-unions, ts-null-undefined, ts-errors]
---*/
// match receives a RegExp parameter whose subclass overrides species; node skips species, resets the global cursor, and returns the exact original exec matches or null.
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
function run(rx: RegExp, text: string): string[] | null { return text.match(rx); }
type Step = [number, number, number, string | null];
const rows: [string, string, string[] | null, Step[]][] = [["ababa", "#b#b#", ["a","a","a"], [[0,1,0,"a"],[1,3,2,"a"],[3,5,4,"a"],[5,0,-1,null]]], ["bbb", "bbb", null, [[0,0,-1,null]]], ["", "", null, [[0,0,-1,null]]]];
for (const Type of [Plain, Further]) for (const row of rows) {
  log.length = 0; const rx: RegExp = new Type("a", "g");
  Object.defineProperty(rx, "constructor", { get() { log.push("constructor", this); throw new Error("constructor read"); } });
  rx.lastIndex = 3.5; const result = run(rx, row[0]);
  same(rx.lastIndex, 0); same(Object.getPrototypeOf(rx), Type.prototype); same(rx instanceof Plain, true); same(rx instanceof Further, Type === Further); if (rx instanceof Plain) same(rx.tag, "plain"); exact(Reflect.ownKeys(rx), ["lastIndex", "tag", "constructor"]);
  same(result === null, row[2] === null); if (result !== null && row[2] !== null) { exact(result, row[2]); same(Array.isArray(result), true); same(Object.getPrototypeOf(result), Array.prototype); const keys: string[] = []; for (let i = 0; i < result.length; i++) { same(Object.hasOwn(result, i), true); keys.push(String(i)); } exact(Reflect.ownKeys(result), [...keys, "length"]); }
  const expected: unknown[] = ["ctor", rx, Type, 2, "a", "g"]; for (const step of row[3]) expected.push("exec", rx, row[0], step[0], step[1], step[2], step[3]); exact(log, expected);
}
