import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeRuleMetadata, type RuleMetadata } from "./rule-metadata.ts";

function permutations<T>(values: T[]): T[][] {
  return values.length ? values.flatMap((value, i) => permutations(values.filter((_, j) => i !== j)).map(tail => [value, ...tail])) : [[]];
}

test("all rule metadata retains the stricter union in every path order", () => {
  const a = { kind: "answers", asks: "one", run: "check-one" };
  const b = { kind: "valid", asks: "two", run: "check-two" };
  const contributions: RuleMetadata[] = [
    { wide: false, full: false, precise: true, arms: [a] },
    { wide: true, full: false, precise: true, arms: [b] },
    { wide: false, full: true, arms: [{ run: "check-one", asks: "one", kind: "answers" }] },
    { precise: true, arms: [a, b] },
  ];
  for (const order of permutations(contributions)) {
    const merged = order.reduce<ReturnType<typeof mergeRuleMetadata> | undefined>((previous, next) => mergeRuleMetadata(previous, next), undefined)!;
    assert.equal(merged.wide, true);
    assert.equal(merged.full, true);
    assert.equal(merged.precise, false);
    assert.equal(merged.arms.length, 2);
    assert.deepEqual(new Set(merged.arms.map(arm => (arm as { run: string }).run)), new Set(["check-one", "check-two"]));
  }
});
test("precision needs every path, and distinct callback obligations remain distinct", () => {
  assert.equal(mergeRuleMetadata(mergeRuleMetadata(undefined, { precise: true }), { precise: true }).precise, true);
  for (const order of permutations<RuleMetadata>([{ precise: true }, {}])) {
    assert.equal(order.reduce<RuleMetadata | undefined>(mergeRuleMetadata, undefined)!.precise, false);
  }
  const one = () => "check", two = () => "check";
  const merged = mergeRuleMetadata({ arms: [{ run: one }] }, { arms: [{ run: two }, { run: one }] });
  assert.equal(merged.arms.length, 2);
  assert.throws(() => mergeRuleMetadata(undefined, { future: true } as unknown as RuleMetadata), /no rule metadata merge policy/);
});
