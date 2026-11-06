import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { acceptedChange, improves } from "./outcome-transition.ts";
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
  const uncompilable = { run: "build", category: "uncompilable-c", nts: "error: use of undeclared identifier '__nts_vN'", node };
  const stored = (now: object) => outcomeRecord(now, "a".repeat(16));
  for (const [was, now, word] of [[wrong, agrees, "FIXED"], [refused, agrees, "FIXED"], [aborted, refused, "REFUSES NOW"],
    [wrong, refused, "REFUSES NOW"], [wrong, aborted, "LOUD NOW"], [wrong, uncompilable, "LOUD NOW"]] as const) {
    const verdict = judge(stored(was), now);
    assert.equal(verdict.word, word, `${was.category} -> ${now.category}`);
    assert.ok(verdict.ok && improves(verdict), `${was.category} -> ${now.category}`);
  }
  for (const [was, now, word] of [[agrees, wrong, "REGRESSED"], [agrees, refused, "REGRESSED"], [refused, wrong, "REGRESSED"],
    [refused, aborted, "REGRESSED"], [aborted, wrong, "REGRESSED"], [aborted, uncompilable, "CHANGED"],
    [wrong, { ...wrong, nts: "exit 0; Observed: x=3;" }, "CHANGED"]] as const) {
    const verdict = judge(stored(was), now);
    assert.equal(verdict.word, word, `${was.category} -> ${now.category}`);
    assert.ok(!verdict.ok && !improves(verdict), `${was.category} -> ${now.category}`);
  }
  assert.match(judge(stored(refused), wrong).why, /^was refused \(NTS1001 a shape\); now wrong-answer/, "a regression from a refusal says so");
  // Refused before and after, for other reasons or with its artefact running
  // differently: accepted, listed and rewritten, though no improvement.
  for (const now of [{ ...refused, nts: "NTS1100 a later shape" }, { ...refused, ran: "exit 1" }]) {
    const verdict = judge(stored(refused), now);
    assert.equal(verdict.word, "REFUSES DIFFERENTLY", JSON.stringify(now));
    assert.ok(verdict.ok && acceptedChange(verdict) && !improves(verdict), verdict.why);
  }
  assert.equal(judge(stored(wrong), wrong).word, "reproduces");
  assert.equal(judge(stored(agrees), { ...agrees, category: "not-measured" }).ok, false);
});

test("a recorded wrong answer that aborts now is improved, with no hand record", () => {
  // tests/outcomes/an-assign-decline-is-swallowed-by-finally's move, in its
  // record's shape: a `check` record holding a structured report that
  // disagrees, measured now as a report that aborts.
  const report = (status: string, disagreements: { compiled: string; node: string }[], aborts: string[]) => ({
    version: 1, status, counts: { functions: 1, expected: 2, compared: 2, unavailable: 0, runtime_declined: 0, timeouts: 0,
      approximated: 0, disagreements: disagreements.length, aborts: aborts.length },
    oracle: { expected: 2, received: 2, complete: true }, refusals: [], disagreements, aborts, error: null });
  const wrong = report("disagrees", [{ compiled: "probe 1 0000000000000000", node: "probe 1 8000000000000000" }], []);
  const aborted = report("aborted", [], ["nts: refused: a decline the finally block swallowed"]);
  const was = outcomeRecord({ run: "check", category: "wrong-answer", nts: "disagrees: 2 compared, 2 expected, 1 disagreements", node: null, check: wrong }, "a".repeat(16));
  const verdict = judge(was, { run: "check", category: "aborted", nts: aborted.aborts[0], node: null, check: aborted });
  assert.equal(verdict.word, "LOUD NOW", verdict.why);
  assert.ok(verdict.ok && improves(verdict), verdict.why);
  assert.equal(judge(outcomeRecord({ run: "check", category: "aborted", nts: aborted.aborts[0], node: null, check: aborted }, "a".repeat(16)),
    { run: "check", category: "wrong-answer", nts: "disagrees", node: null, check: wrong }).word, "REGRESSED", "and back is a regression");
});
