import assert from "node:assert/strict";
import { test } from "node:test";
import { gateSteps, owed } from "./owed.mjs";

const steps = (path: string): string[] => {
  const rules = owed([{ path, added: true }]);
  assert.equal(rules.some((rule: { full?: boolean }) => rule.full), false, path);
  return gateSteps(rules);
};
function includes(actual: string[], expected: string[]): void {
  for (const step of expected) assert.ok(actual.includes(step), `${step} absent from ${actual}`);
}

test("oracle shards owe their execution readers and the strict inventory control", () => {
  const program = steps("results/oracle-counts/tests/programs/a-future-program.json");
  includes(program, ["tooling", "examples", "llvm", "llvm-rc", "jvm", "rc"]);
  assert.ok(!program.includes("bench-agree"));
  const benchmark = steps("results/oracle-counts/benchmarks/cases/a-future-benchmark.json");
  includes(benchmark, ["tooling", "bench-agree"]);
  for (const unrelated of ["examples", "llvm", "llvm-rc", "jvm", "rc", "test262"]) assert.ok(!benchmark.includes(unrelated), unrelated);
  includes(steps("results/oracle-counts/_generator.json"), ["tooling", "examples", "llvm", "llvm-rc", "jvm", "rc", "bench-agree"]);
  includes(steps("results/oracle-counts/unexpected-file.json"), ["tooling"]);
});
