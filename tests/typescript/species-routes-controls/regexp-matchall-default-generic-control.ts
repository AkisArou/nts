/*---
description: "Control for regexp-matchall-default-generic; RegExp matchAll constructs the runtime subclass eagerly and copies its starting cursor into an independent lazy iterator."
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-builtin-subclass, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-override, ts-static, ts-symbols, ts-accessors, ts-this, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-objects, ts-tuples, ts-rest-parameters, ts-instanceof, ts-generics, ts-generic-constraints, ts-type-aliases, ts-errors, ts-unions, ts-null-undefined]
---*/
// matchAll receives a generic RegExp parameter and returns a base iterator; node preserves the subclass constructor, copies ToLength(lastIndex), and executes only the independent clone. The control uses explicit construction and exec steps.
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
function stream(rx: RegExp, text: string): Iterator<RegExpExecArray, undefined> {
  if (!rx.flags.includes("g")) throw new TypeError(); const C = species(rx), flags = rx.flags;
  const built: unknown = Reflect.construct(C, [rx, flags]); if (!(built instanceof RegExp)) throw new TypeError();
  const start = rx.lastIndex; built.lastIndex = Number.isNaN(start) ? 0 : Math.min(9007199254740991, Math.max(0, Math.floor(start)));
  const unicode = flags.includes("u") || flags.includes("v"); let done = false;
  return { next(): IteratorResult<RegExpExecArray, undefined> {
    if (done) return { value: undefined, done: true }; const hit = built.exec(text);
    if (hit === null) { done = true; return { value: undefined, done: true }; }
    if (hit[0] === "") built.lastIndex = advance(text, built.lastIndex, unicode); return { value: hit, done: false };
  } };
}
function run<T extends RegExp>(rx: T, text: string): Iterator<RegExpExecArray, undefined> { return stream(rx, text); }
type Step = [number, number, number, string | null];
const zero: Step[] = [[0,1,0,"a"],[1,3,2,"a"],[3,5,4,"a"],[5,0,-1,null]];
const rows: [number, number, number[], Step[]][] = [[0,0,[0,2,4],zero],[-1,0,[0,2,4],zero],[NaN,0,[0,2,4],zero],[2.8,2,[2,4],[[2,3,2,"a"],[3,5,4,"a"],[5,0,-1,null]]],[6,6,[],[[6,0,-1,null]]]];
for (const Type of [Trace, Middle, Leaf]) for (const flags of ["g", "gi", "gu", "gv"]) for (const row of rows) {
  log.length = 0; made.length = 0; const rx: RegExp = new Type("a", flags); rx.lastIndex = row[0]; const iterator = run(rx, "ababa"), matcher = made[1];
  same(made.length, 2); same(matcher === rx, false); same(rx.lastIndex, row[0]); same(matcher.lastIndex, row[1]); rx.lastIndex = 19;
  same(Object.getPrototypeOf(matcher), Type.prototype); same(matcher instanceof RegExp, true); same(matcher instanceof Trace, true);
  same(matcher instanceof Middle, Type !== Trace); same(matcher instanceof Leaf, Type === Leaf); if (matcher instanceof Trace) same(matcher.tag, "trace"); if (matcher instanceof Middle) same(matcher.middle, "middle"); exact(Reflect.ownKeys(matcher), Type === Trace ? ["lastIndex", "tag"] : ["lastIndex", "tag", "middle"]);
  const indices: number[] = []; let step = iterator.next(); while (!step.done) { same(step.value[0], "a"); same(step.value.input, "ababa"); same(Array.isArray(step.value), true); same(Object.getPrototypeOf(step.value), Array.prototype); exact(Reflect.ownKeys(step.value), ["0", "length", "index", "input", "groups"]); indices.push(step.value.index); step = iterator.next(); }
  same(step.value, undefined); same(iterator.next().done, true); exact(indices, row[2]); same(rx.lastIndex, 19); same(matcher.lastIndex, 0);
  const expected: unknown[] = ["ctor", rx, Type, 2, "a", flags]; if (Type !== Trace) expected.push("middle", rx, Type, 2, "a", flags);
  expected.push("species", Type, "ctor", matcher, Type, 2, rx, flags); if (Type !== Trace) expected.push("middle", matcher, Type, 2, rx, flags);
  for (const entry of row[3]) expected.push("exec", matcher, "ababa", entry[0], entry[1], entry[2], entry[3]); exact(log, expected);
}
