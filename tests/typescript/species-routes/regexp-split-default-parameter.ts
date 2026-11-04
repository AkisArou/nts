/*---
description: "RegExp split selects the runtime subclass and executes only its newly constructed sticky splitter."
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-builtin-subclass, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-override, ts-static, ts-symbols, ts-accessors, ts-this, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-objects, ts-tuples, ts-rest-parameters, ts-instanceof, ts-type-aliases, ts-unions, ts-null-undefined]
---*/
// split receives a RegExp parameter holding Trace, Middle or Leaf; node constructs with (original, flags plus y), runs only the splitter exec, and leaves the original cursor untouched.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [], made: RegExp[] = [];
class Trace extends RegExp {
  tag: string = "trace";
  constructor(...args: [string | RegExp, string?]) { super(...args); made.push(this); log.push("ctor", this, new.target, args.length, args[0], args[1]); }
  static override get [Symbol.species](): RegExpConstructor { log.push("species", this); return super[Symbol.species]; }
  override exec(text: string): RegExpExecArray | null { const before = this.lastIndex, hit = RegExp.prototype.exec.call(this, text); log.push("exec", this, text, before, this.lastIndex, hit === null ? -1 : hit.index, hit === null ? null : hit[0]); return hit; }
}
class Middle extends Trace { middle: string = "middle"; constructor(...args: [string | RegExp, string?]) { super(...args); log.push("middle", this, new.target, args.length, args[0], args[1]); } }
class Leaf extends Middle {}
function run(rx: RegExp, text: string): (string | undefined)[] { return text.split(rx); }
type Step = [number, number, number, string | null];
const rows: [string, (string | undefined)[], Step[]][] = [
  ["a,b;c", ["a", ",", "b", undefined, "c"], [[0,0,-1,null],[1,2,1,","],[2,0,-1,null],[3,4,3,";"],[4,0,-1,null]]],
  [",;", ["", ",", "", undefined, ""], [[0,1,0,","],[1,2,1,";"]]], ["", [""], [[0,0,-1,null]]]
];
for (const Type of [Trace, Middle, Leaf]) for (const flags of ["", "g", "y", "gu", "gy", "gv"]) for (const row of rows) {
  log.length = 0; made.length = 0; const rx: RegExp = new Type("(,)|;", flags); rx.lastIndex = 7.5; const result = run(rx, row[0]), splitter = made[1];
  same(rx.lastIndex, 7.5); same(made.length, 2); same(splitter === rx, false); same(Object.getPrototypeOf(splitter), Type.prototype);
  same(splitter instanceof RegExp, true); same(splitter instanceof Trace, true); same(splitter instanceof Middle, Type !== Trace); same(splitter instanceof Leaf, Type === Leaf);
  if (splitter instanceof Trace) same(splitter.tag, "trace"); if (splitter instanceof Middle) same(splitter.middle, "middle"); exact(Reflect.ownKeys(splitter), Type === Trace ? ["lastIndex", "tag"] : ["lastIndex", "tag", "middle"]);
  exact(result, row[1]); same(result.length, row[1].length); same(Array.isArray(result), true); same(Object.getPrototypeOf(result), Array.prototype);
  const keys: string[] = []; for (let i = 0; i < result.length; i++) { same(Object.hasOwn(result, i), true); keys.push(String(i)); } exact(Object.keys(result), keys); exact(Reflect.ownKeys(result), [...keys, "length"]);
  const expected: unknown[] = ["ctor", rx, Type, 2, "(,)|;", flags]; if (Type !== Trace) expected.push("middle", rx, Type, 2, "(,)|;", flags);
  const nextFlags = flags.includes("y") ? flags : flags + "y"; expected.push("species", Type, "ctor", splitter, Type, 2, rx, nextFlags);
  if (Type !== Trace) expected.push("middle", splitter, Type, 2, rx, nextFlags); for (const step of row[2]) expected.push("exec", splitter, row[0], step[0], step[1], step[2], step[3]); exact(log, expected);
}
