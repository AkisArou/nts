/*---
description: "Control for regexp-replace-no-species-interface; RegExp replace never reads a species override through an interface field and executes the original subclass."
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-builtin-subclass, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-override, ts-static, ts-symbols, ts-accessors, ts-this, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-objects, ts-tuples, ts-rest-parameters, ts-instanceof, ts-interfaces, ts-type-aliases, ts-unions, ts-null-undefined, ts-errors]
---*/
// replace receives an interface RegExp field whose subclass returns RegExp from species; node skips species, resets the original global cursor, and logs only original exec calls. The control uses explicit construction and exec steps.
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
interface Holder { rx: RegExp; }
function run(holder: Holder, text: string): string {
  const rx = holder.rx; rx.lastIndex = 0; let result = "", end = 0, hit = rx.exec(text);
  while (hit !== null) { result += text.slice(end, hit.index) + "#"; end = hit.index + hit[0].length; hit = rx.exec(text); }
  return result + text.slice(end);
}
type Step = [number, number, number, string | null];
const rows: [string, string, string[] | null, Step[]][] = [["ababa", "#b#b#", ["a","a","a"], [[0,1,0,"a"],[1,3,2,"a"],[3,5,4,"a"],[5,0,-1,null]]], ["bbb", "bbb", null, [[0,0,-1,null]]], ["", "", null, [[0,0,-1,null]]]];
for (const Type of [Plain, Further]) for (const row of rows) {
  log.length = 0; const holder: Holder = { rx: new Type("a", "g") };
  Object.defineProperty(holder.rx, "constructor", { get() { log.push("constructor", this); throw new Error("constructor read"); } });
  holder.rx.lastIndex = 3.5; const result = run(holder, row[0]);
  same(holder.rx.lastIndex, 0); same(Object.getPrototypeOf(holder.rx), Type.prototype); same(holder.rx instanceof Plain, true); same(holder.rx instanceof Further, Type === Further); if (holder.rx instanceof Plain) same(holder.rx.tag, "plain"); exact(Reflect.ownKeys(holder.rx), ["lastIndex", "tag", "constructor"]);
  same(result, row[1]);
  const expected: unknown[] = ["ctor", holder.rx, Type, 2, "a", "g"]; for (const step of row[3]) expected.push("exec", holder.rx, row[0], step[0], step[1], step[2], step[3]); exact(log, expected);
}
