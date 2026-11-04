/*---
description: "RegExp matchAll uses an overridden builtin species and advances empty Unicode matches through a typed tuple."
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-builtin-subclass, ts-class, ts-class-fields, ts-inheritance, ts-new-target, ts-override, ts-static, ts-symbols, ts-accessors, ts-this, ts-functions, ts-arrays, ts-iteration, ts-strings, ts-numbers, ts-unknown, ts-typeof-operator, ts-objects, ts-tuples, ts-rest-parameters, ts-instanceof, ts-type-aliases, ts-errors, ts-this-parameter, ts-unions, ts-null-undefined]
---*/
// matchAll receives RegExp and text in a tuple; node uses builtin RegExp, copies the initial cursor, advances Unicode empty matches, and keeps later original changes independent.
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
type Input = [RegExp, string];
function run(input: Input): Iterator<RegExpExecArray, undefined> { return input[1].matchAll(input[0]); }
const rows: [number, number[], number[]][] = [[0, [0,1,2,3], [0,2,3]], [2, [2,3], [2,3]], [4, [], []]];
try { for (const Type of [Plain, Further]) for (const flags of ["g", "gu", "gv"]) for (const row of rows) {
  log.length = 0; seen.length = 0; calls.length = 0; const input: Input = [new Type("(?:)", flags), "\ud83d\ude00X"]; input[0].lastIndex = row[0]; const iterator = run(input);
  same(input[0].lastIndex, row[0]); input[0].lastIndex = 9; same(Object.getPrototypeOf(input[0]), Type.prototype); same(input[0] instanceof Plain, true); same(input[0] instanceof Further, Type === Further); if (input[0] instanceof Plain) same(input[0].tag, "plain");
  exact(Reflect.ownKeys(input[0]), ["lastIndex", "tag"]); exact(log, ["ctor", input[0], Type, 2, "(?:)", flags, "species", Type]); same(calls.length, 0); same(seen.length, 0);
  const indices: number[] = []; let step = iterator.next(); while (!step.done) { same(step.value[0], ""); same(step.value.input, input[1]); same(Array.isArray(step.value), true); same(Object.getPrototypeOf(step.value), Array.prototype); exact(Reflect.ownKeys(step.value), ["0", "length", "index", "input", "groups"]); indices.push(step.value.index); step = iterator.next(); }
  exact(indices, flags.includes("u") || flags.includes("v") ? row[2] : row[1]); same(step.value, undefined); same(iterator.next().done, true); same(input[0].lastIndex, 9);
  const matcher = seen[0]; same(matcher === input[0], false); same(Object.getPrototypeOf(matcher), RegExp.prototype); same(matcher instanceof RegExp, true); same(matcher instanceof Plain, false); same(matcher instanceof Further, false); same(Array.isArray(matcher), false); exact(Reflect.ownKeys(matcher), ["lastIndex"]);
  same(matcher.source, "(?:)"); same(matcher.flags, flags); same(matcher.lastIndex, 0); const positions = flags.includes("u") || flags.includes("v") ? row[2] : row[1]; same(seen.length, positions.length + 1);
  const expected: unknown[] = []; for (const position of positions) expected.push("exec", matcher, input[1], position, position, position, ""); expected.push("exec", matcher, input[1], 4, 0, -1, null); exact(calls, expected);
  exact(log, ["ctor", input[0], Type, 2, "(?:)", flags, "species", Type]);
} } finally { RegExp.prototype.exec = intrinsicExec; }
