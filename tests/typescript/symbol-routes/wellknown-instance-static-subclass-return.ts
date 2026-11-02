/*---
description: A static instance matcher inherited by a subclass receives the returned constructor as its receiver.
features: [ts-symbol-route-well-known, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-interfaces, ts-narrowing, ts-strings, ts-symbols]
---*/
// Symbol.hasInstance: A constructor returned as typeof MatcherBase is used by instanceof; node binds the inherited static hook to the selected base or child constructor.
const log: unknown[] = [];
interface Candidate { kind: string; }
class MatcherBase {
  static kind: string = "base";
  static [Symbol.hasInstance](value: unknown): boolean {
    log.push(this, value, this.kind); return typeof value === "object" && value !== null && "kind" in value && value.kind === this.kind;
  }
}
class MatcherChild extends MatcherBase { static kind: string = "child"; }
function select(child: boolean): typeof MatcherBase { return child ? MatcherChild : MatcherBase; }
function accepts(target: typeof MatcherBase, candidate: Candidate): boolean { return candidate instanceof target; }
for (const child of [false, true]) {
  const target = select(child), kind = child ? "child" : "base";
  const candidates: Candidate[] = [{ kind: "base" }, { kind: "child" }, { kind: "other" }];
  for (const candidate of candidates) {
    log.length = 0; assert.sameValue(accepts(target, candidate), candidate.kind === kind);
    assert.compareArray(log, [target, candidate, kind]); assert.sameValue(target.kind, kind);
  }
}
