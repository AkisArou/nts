import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { acceptedLine, improvedLine, inventory, isListedLine, listedIn, pendingLine, refusesDifferentlyLine } from "./pending.ts";
import { testScratch } from "../gate/test-scratch.ts";

test("a case without a row is pending and a row without a case is stale", () => {
  assert.deepEqual(inventory(["a", "b"], ["b", "c", "d"]), { pending: ["c", "d"], stale: ["a"] });
  assert.deepEqual(inventory(["a"], ["a"]), { pending: [], stale: [] });
});

test("every check names a pending case and an accepted change in one shared line, with the record that holds its row", () => {
  assert.equal(pendingLine("tests/outcomes/new", "tests/outcomes/new/outcome.json"),
    "pending: tests/outcomes/new is not recorded in tests/outcomes/new/outcome.json yet");
  assert.equal(improvedLine("benchmarks/cases/x", "results/benchmarks/c/outcomes.tsv", "refused", "pass"),
    "improved, record pending: benchmarks/cases/x in results/benchmarks/c/outcomes.tsv: refused -> pass");
  assert.equal(refusesDifferentlyLine("tests/typescript/a.ts", "results/typescript/c/cases.tsv", "NTS1001", "NTS1100"),
    "refuses differently, record pending: tests/typescript/a.ts in results/typescript/c/cases.tsv: NTS1001 -> NTS1100");
  assert.equal(acceptedLine({ word: "REFUSES DIFFERENTLY", ok: true, loud: true }, "a", "r", "b", "c"), refusesDifferentlyLine("a", "r", "b", "c"));
  assert.equal(acceptedLine({ word: "LOUD NOW", ok: true, loud: true }, "a", "r", "b", "c"), improvedLine("a", "r", "b", "c"));
});

test("a run's step logs list each pending case and accepted change once, with its record", t => {
  const run = testScratch(t, "listed-in");
  writeFileSync(join(run, "typescript-c.log"), [
    `  ${pendingLine("tests/typescript/a/b.ts", "results/typescript/c/cases.tsv")}`,
    `  ${improvedLine("tests/typescript/a/c.ts", "results/typescript/c/cases.tsv", '{"kind":"refused"}', '{"kind":"pass"}')}`,
    "a line that says pending: but is no record line",
  ].join("\n"));
  writeFileSync(join(run, "outcomes.log"), [
    pendingLine("tests/outcomes/x", "tests/outcomes/x/outcome.json"),
    refusesDifferentlyLine("tests/outcomes/y", "tests/outcomes/y/outcome.json", "refused (NTS1001)", "refused (NTS1100)"),
  ].join("\n"));
  writeFileSync(join(run, "typescript-llvm.log"), `${pendingLine("tests/typescript/a/b.ts", "results/typescript/c/cases.tsv")}\n`);
  writeFileSync(join(run, "summary.json"), `${pendingLine("tests/outcomes/z", "nowhere")}\n`);
  assert.deepEqual(listedIn(run), {
    pending: [{ name: "tests/typescript/a/b.ts", record: "results/typescript/c/cases.tsv" }, { name: "tests/outcomes/x", record: "tests/outcomes/x/outcome.json" }],
    accepted: [
      { name: "tests/typescript/a/c.ts", record: "results/typescript/c/cases.tsv", change: 'improved {"kind":"refused"} -> {"kind":"pass"}' },
      { name: "tests/outcomes/y", record: "tests/outcomes/y/outcome.json", change: "refuses differently refused (NTS1001) -> refused (NTS1100)" },
    ],
  });
  assert.deepEqual(listedIn(join(run, "missing")), { pending: [], accepted: [] });
  assert.ok(isListedLine(`  ${refusesDifferentlyLine("a", "r", "b", "c")}`) && !isListedLine("improved, but not a record line"));
});
