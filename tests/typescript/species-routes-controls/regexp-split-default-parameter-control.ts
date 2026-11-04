/*---
description: "Control for regexp-split-default-parameter; RegExp split selects the runtime subclass and executes only its newly constructed sticky splitter."
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-builtin-subclass, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-override, ts-static, ts-symbols, ts-accessors, ts-this, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-objects, ts-tuples, ts-rest-parameters, ts-instanceof, ts-type-aliases, ts-errors, ts-unions, ts-null-undefined]
---*/
// split receives a RegExp parameter holding Trace, Middle or Leaf; node constructs with (original, flags plus y), runs only the splitter exec, and leaves the original cursor untouched. The control uses explicit construction and exec steps.
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
function species(rx: RegExp): Function {
  const ctor: unknown = rx.constructor; if (ctor === undefined) return RegExp; if ((typeof ctor !== "object" || ctor === null) && typeof ctor !== "function") throw new TypeError();
  const selected: unknown = Reflect.get(ctor, Symbol.species); if (selected === undefined || selected === null) return RegExp;
  if (typeof selected !== "function") throw new TypeError(); return selected; }
function advance(text: string, index: number, unicode: boolean): number { const a = text.charCodeAt(index), b = text.charCodeAt(index + 1); return index + (unicode && a >= 0xd800 && a <= 0xdbff && b >= 0xdc00 && b <= 0xdfff ? 2 : 1); }
function split(rx: RegExp, text: string): (string | undefined)[] {
  const C = species(rx), flags = rx.flags, unicode = flags.includes("u") || flags.includes("v");
  const built: unknown = Reflect.construct(C, [rx, flags.includes("y") ? flags : flags + "y"]); if (!(built instanceof RegExp)) throw new TypeError();
  const result: (string | undefined)[] = []; if (text.length === 0) { if (built.exec(text) === null) result.push(""); return result; }
  let end = 0, index = 0;
  while (index < text.length) {
    built.lastIndex = index; const hit = built.exec(text); if (hit === null) { index = advance(text, index, unicode); continue; }
    const next = Math.min(text.length, Math.max(0, Math.floor(built.lastIndex))); if (next === end) { index = advance(text, index, unicode); continue; }
    result.push(text.slice(end, index)); for (let capture = 1; capture < hit.length; capture++) result.push(hit[capture]); end = next; index = end;
  }
  result.push(text.slice(end)); return result;
}
function run(rx: RegExp, text: string): (string | undefined)[] { return split(rx, text); }
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
