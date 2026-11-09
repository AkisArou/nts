// The test262 census and its writer, run for real over test/harness against
// fixture records: a whole run held to a record lists each case that runs now
// and has no row as pending, and each recorded fail that passes as improved,
// each line naming the record, and passes; the writer measures exactly the
// listed cases, repeated, and writes their rows and nothing else; a recorded
// case the selection does not have is missing, and fails the check.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { provenanceOf, publishPin } from "../conformance/pin.ts";
import { ownMemoryEnv } from "../gate/test-memory.ts";
import { removable } from "../gate/run-temporary.ts";
import { newTestScratch } from "../gate/test-scratch.ts";
import { improvedLine, pendingLine } from "../records/pending.ts";
import { parseTest262Record } from "./test262-record.ts";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const binary = resolve(repository, process.env.NTS_BIN ?? "target/release/nts");
const RECORD = "results/test262/c/harness.tsv";
const literally = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

test("a whole test262 run lists the cases its record lacks and its fails that pass, and the writer records exactly those",
  { skip: existsSync(join(repository, "third_party/test262/.git")) ? false : "no test262 checkout" }, t => {
  assert.ok(existsSync(binary), `compiler missing: ${binary}; set NTS_BIN to a built pin`);
  const scratch = newTestScratch("test262-census");
  t.after(() => { removable(scratch); rmSync(scratch, { recursive: true, force: true }); });
  // The writer writes a claim about a commit, so it runs from a clean pin.
  const pinned = publishPin(binary, join(scratch, "pin"), provenanceOf(binary) ?? {
    sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim(),
    subject: "test fixture copy of the gate compiler", clean: true, applied: null, built_at: new Date().toISOString(),
  });
  const real = readFileSync(join(repository, RECORD), "utf8");
  const [gone, fixed] = parseTest262Record(real).rows.filter(row => row.outcome === "pass").map(row => row.path);
  assert.ok(gone && fixed, `${RECORD} records two passes to take from`);
  // One recorded pass taken out of the record, and another recorded as a fail.
  const fixture = join(scratch, "harness.tsv");
  writeFileSync(fixture, real.split("\n").filter(line => !line.startsWith(`${gone}\t`))
    .map(line => line.startsWith(`${fixed}\t`) ? `${fixed}\tfail\tuncaught Test262Error: a fixture's fail` : line).join("\n"));
  const census = (...args: string[]) => spawnSync(process.execPath, ["tooling/census/conformance262.ts", "--under", "test/harness", "--jobs", "4", ...args],
    { cwd: repository, encoding: "utf8", env: ownMemoryEnv(join(scratch, "memory"), { ...process.env, NTS_BIN: pinned }) });

  const checked = census("--check", fixture);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.match(checked.stdout, literally(`${pendingLine(gone!, fixture)}: pass`));
  assert.match(checked.stdout, literally(improvedLine(fixed!, fixture, "fail", "pass")));
  assert.equal(readFileSync(fixture, "utf8").includes(`${gone}\t`), false, "a check lists, and writes nothing");

  const recorded = census("--record-pending", fixture, "--case", gone!, "--case", fixed!, "--repeats", "2");
  assert.equal(recorded.status, 0, recorded.stdout + recorded.stderr);
  assert.match(recorded.stdout, /^ {9}0 {2}UNSTABLE$/m);
  assert.equal(readFileSync(fixture, "utf8"), real, "the writer restores the two rows, every other line byte for byte");

  writeFileSync(fixture, `${real}test/harness/no-such-case.js\tpass\t\n`);
  const missing = census("--check", fixture);
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.match(missing.stdout, /no-such-case\.js: recorded, not in the selection/);

  // A case that runs now and fails is pending too, with what it threw: listed, and the run passes.
  const annexB = readFileSync(join(repository, "results/test262/c/annexb.tsv"), "utf8");
  const failing = parseTest262Record(annexB).rows.find(row => row.outcome === "fail");
  assert.ok(failing, "the annexB record holds a fail to take out");
  writeFileSync(fixture, annexB.split("\n").filter(line => !line.startsWith(`${failing!.path}\t`)).join("\n"));
  const failed = spawnSync(process.execPath, ["tooling/census/conformance262.ts", "--under", "test/annexB", "--jobs", "4", "--check", fixture],
    { cwd: repository, encoding: "utf8", env: ownMemoryEnv(join(scratch, "memory"), { ...process.env, NTS_BIN: pinned }) });
  assert.equal(failed.status, 0, failed.stdout + failed.stderr);
  assert.match(failed.stdout, literally(`${pendingLine(failing!.path, fixture)}: fail: ${failing!.detail}`));
});
