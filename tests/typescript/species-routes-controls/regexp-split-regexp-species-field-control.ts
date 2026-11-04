/*---
description: "Control for regexp-split-regexp-species-field; RegExp split uses an overridden builtin species through an interface field, including Unicode empty matches."
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-builtin-subclass, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-override, ts-static, ts-symbols, ts-accessors, ts-this, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-objects, ts-tuples, ts-rest-parameters, ts-instanceof, ts-interfaces, ts-errors, ts-this-parameter, ts-unions, ts-null-undefined]
---*/
// split receives an interface field typed RegExp; node reads the override once, uses builtin RegExp without subclass exec, and splits zero-width Unicode matches without changing the original. The control uses explicit construction and exec steps.
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
const intrinsicExec = RegExp.prototype.exec, seen: RegExp[] = [], calls: unknown[] = [];
RegExp.prototype.exec = function(this: RegExp, text: string): RegExpExecArray | null { const before = this.lastIndex, hit = intrinsicExec.call(this, text); seen.push(this); calls.push("exec", this, text, before, this.lastIndex, hit === null ? -1 : hit.index, hit === null ? null : hit[0]); return hit; };
interface Holder { rx: RegExp; }
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
function run(holder: Holder, text: string): (string | undefined)[] { return split(holder.rx, text); }
const rows: [string, string[], string[]][] = [["", [], []], ["a", ["a"], ["a"]], ["\ud83d\ude00X", ["\ud83d", "\ude00", "X"], ["\ud83d\ude00", "X"]]];
try { for (const Type of [Plain, Further]) for (const flags of ["", "u", "v", "y"]) for (const row of rows) {
  log.length = 0; seen.length = 0; calls.length = 0; const holder: Holder = { rx: new Type("(?:)", flags) }; holder.rx.lastIndex = 4; const result = run(holder, row[0]), splitter = seen[0];
  same(holder.rx.lastIndex, 4); same(Object.getPrototypeOf(holder.rx), Type.prototype); same(holder.rx instanceof Plain, true); same(holder.rx instanceof Further, Type === Further); if (holder.rx instanceof Plain) same(holder.rx.tag, "plain");
  exact(Reflect.ownKeys(holder.rx), ["lastIndex", "tag"]); exact(result, flags.includes("u") || flags.includes("v") ? row[2] : row[1]); same(Array.isArray(result), true); same(Object.getPrototypeOf(result), Array.prototype);
  const keys: string[] = []; for (let i = 0; i < result.length; i++) { same(Object.hasOwn(result, i), true); keys.push(String(i)); } exact(Reflect.ownKeys(result), [...keys, "length"]);
  same(splitter === holder.rx, false); same(Object.getPrototypeOf(splitter), RegExp.prototype); same(splitter instanceof RegExp, true); same(splitter instanceof Plain, false); same(splitter instanceof Further, false); same(Array.isArray(splitter), false); exact(Reflect.ownKeys(splitter), ["lastIndex"]);
  same(splitter.source, "(?:)"); same(splitter.flags, flags.includes("y") ? flags : flags + "y"); for (const receiver of seen) same(receiver, splitter); const positions = row[0].length < 2 ? [0] : flags.includes("u") || flags.includes("v") ? [0,2,2] : [0,1,1,2,2];
  // Node 24.20.0 adds an exec at the low surrogate with v; only its presence/count is unasserted (PR reproducer).
  const expected: unknown[] = []; for (const position of positions) expected.push("exec", splitter, row[0], position, position, position, ""); const observed: unknown[] = [];
  for (let i = 0; i < calls.length; i += 7) { same(calls[i + 1], splitter); same(calls[i + 2], row[0]); if (flags === "v" && row[0].length === 3 && calls[i + 3] === 1) { same(calls[i + 4], 0); same(calls[i + 5], 0); same(calls[i + 6], ""); continue; } for (let j = 0; j < 7; j++) observed.push(calls[i + j]); }
  same(seen.length * 7, calls.length); exact(observed, expected);
  exact(log, ["ctor", holder.rx, Type, 2, "(?:)", flags, "species", Type]);
} } finally { RegExp.prototype.exec = intrinsicExec; }
