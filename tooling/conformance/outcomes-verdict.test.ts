import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { improves } from "./outcome-transition.ts";
import { judge, outcomeInventory, outcomeRecord } from "./outcomes-verdict.ts";

test("a fixture with no record is pending, and a record whose program is gone is stale", t => {
  const base = join(homedir(), ".cache/nts/outcomes-verdict-tests");
  mkdirSync(base, { recursive: true });
  const directory = mkdtempSync(join(base, "fixtures-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [name, files] of [["recorded", ["src/main.ts", "outcome.json"]], ["new", ["src/main.ts"]], ["deleted", ["outcome.json"]]] as const) {
    for (const file of files) {
      mkdirSync(dirname(join(directory, name, file)), { recursive: true });
      writeFileSync(join(directory, name, file), "{}\n");
    }
  }
  assert.deepEqual(outcomeInventory(directory, ["deleted", "new", "recorded"]), { pending: ["new"], stale: ["deleted"] });
});

test("an improvement passes and is listed; a regression or a change still fails", () => {
  const node = "exit 0; Observed: x=1;";
  const agrees = { run: "build", category: "agrees", nts: node, node };
  const wrong = { run: "build", category: "wrong-answer", nts: "exit 0; Observed: x=2;", node };
  const aborted = { run: "build", category: "aborted", nts: "SIGSEGV; nts: refused: index 1 is outside [0, 1)", node };
  const refused = { run: "build", category: "refused", nts: "NTS1001 a shape", ran: "exit 0", node };
  const stored = (now: object) => outcomeRecord(now, "a".repeat(16));
  for (const [was, now, word] of [[wrong, agrees, "FIXED"], [refused, agrees, "FIXED"], [aborted, refused, "REFUSES NOW"]] as const) {
    const verdict = judge(stored(was), now);
    assert.equal(verdict.word, word);
    assert.ok(verdict.ok && improves(verdict), `${was.category} -> ${now.category}`);
  }
  for (const [was, now, word] of [[agrees, wrong, "REGRESSED"], [agrees, refused, "REGRESSED"], [refused, wrong, "CHANGED"], [wrong, aborted, "CHANGED"]] as const) {
    const verdict = judge(stored(was), now);
    assert.equal(verdict.word, word);
    assert.ok(!verdict.ok && !improves(verdict), `${was.category} -> ${now.category}`);
  }
  assert.equal(judge(stored(wrong), wrong).word, "reproduces");
  assert.equal(judge(stored(agrees), { ...agrees, category: "not-measured" }).ok, false);
});
