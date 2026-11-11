import {testEnvironment} from "../gate/test-environment.ts";
// The test262 census and its writer, run for real on the cases each check
// manipulates, against fixture records of only those cases: a run held to a
// record lists each case that runs now and has no row as pending, and each
// recorded fail that passes as improved, each line naming the record, and
// passes; the writer measures exactly the listed cases, repeated, and writes
// their rows and nothing else; a recorded case the selection does not have is
// missing, and fails the check. The mechanism is under test here: a case the
// compiler gets wrong is the census steps' to judge, so no case beyond the
// ones a check names runs, and none can turn this test red.
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
import { stoppedWith } from "./attempt262.ts";
import { parseTest262Record } from "./test262-record.ts";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const binary = resolve(repository, process.env.NTS_BIN ?? "target/release/nts");
const RECORD = "results/test262/c/harness.tsv";
const literally = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

test("what the compiler printed as it stopped is kept as printed: its panic to the note after it, or its last lines", () => {
  assert.equal(stoppedWith([
    "nts: refused something earlier",
    "thread 'nts' (81234) panicked at compiler/core/src/lower.rs:12:3:",
    "index out of bounds: the len is 2 but the index is 7",
    "note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace",
  ].join("\n")), "thread 'nts' (81234) panicked at compiler/core/src/lower.rs:12:3:\nindex out of bounds: the len is 2 but the index is 7");
  assert.equal(stoppedWith("\nthread 'nts-tsrs' has overflowed its stack\nfatal runtime error: stack overflow\n"),
    "thread 'nts-tsrs' has overflowed its stack\nfatal runtime error: stack overflow");
  assert.equal(stoppedWith("one\ntwo\nthree\nfour\nfive\nsix\nseven\n"), "two\nthree\nfour\nfive\nsix\nseven", "no panic: its last lines");
  assert.equal(stoppedWith(""), "(it printed nothing)");
});

test("a test262 run held to a record lists the cases it lacks and its fails that pass, and the writer records exactly those",
  { skip: existsSync(join(repository, "third_party/test262/.git")) ? false : "no test262 checkout" }, t => {
  assert.ok(existsSync(binary), `compiler missing: ${binary}; set NTS_BIN to a built pin`);
  const scratch = newTestScratch("test262-census");
  t.after(() => { removable(scratch); rmSync(scratch, { recursive: true, force: true }); });
  // The writer writes a claim about a commit, so it runs from a clean pin.
  const pinned = publishPin(binary, join(scratch, "pin"), provenanceOf(binary) ?? {
    sha: execFileSync("git", ["rev-parse", "HEAD"], {env:testEnvironment(), cwd: repository, encoding: "utf8" }).trim(),
    subject: "test fixture copy of the gate compiler", clean: true, applied: null, built_at: new Date().toISOString(),
  });
  const real = readFileSync(join(repository, RECORD), "utf8");
  const [gone, fixed] = parseTest262Record(real).rows.filter(row => row.outcome === "pass").map(row => row.path);
  assert.ok(gone && fixed, `${RECORD} records two passes to take from`);
  // A record of the real one's header and the given rows, as the writer writes one.
  const recordOf = (contents: string, ...rows: string[]) => [...contents.split("\n").filter(line => line.startsWith("#")), ...rows, ""].join("\n");
  const fixture = join(scratch, "record.tsv"), selection = join(scratch, "selection.tsv");
  const census = (under: string, ...args: string[]) => spawnSync(process.execPath, ["tooling/census/conformance262.ts", "--under", under, "--jobs", "2", ...args],
    { cwd: repository, encoding: "utf8", env: ownMemoryEnv(join(scratch, "memory"), { ...testEnvironment(), NTS_BIN: pinned }) });

  // One recorded pass with no row, and another recorded as a fail: the two cases selected.
  writeFileSync(selection, `${gone}\n${fixed}\n`);
  writeFileSync(fixture, recordOf(real, `${fixed}\tfail\tuncaught Test262Error: a fixture's fail`));
  const checked = census("test/harness", "--check", fixture, "--paths-from", selection);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.match(checked.stderr,/census start: test\/harness; 2 case\(s\); 2 worker\(s\)/);
  assert.match(checked.stderr,/census complete: test\/harness; 2\/2 attempted; 2 worker\(s\); [\d.]+ s elapsed/);
  assert.match(checked.stdout, literally(`${pendingLine(gone!, fixture)}: pass`));
  assert.match(checked.stdout, literally(improvedLine(fixed!, fixture, "fail", "pass")));
  assert.equal(readFileSync(fixture, "utf8").includes(`${gone}\t`), false, "a check lists, and writes nothing");

  const recorded = census("test/harness", "--record-pending", fixture, "--case", gone!, "--case", fixed!, "--repeats", "2");
  assert.equal(recorded.status, 0, recorded.stdout + recorded.stderr);
  assert.match(recorded.stdout, /^ {9}0 {2}UNSTABLE$/m);
  assert.equal(readFileSync(fixture, "utf8"), recordOf(real, `${gone}\tpass\t`, `${fixed}\tpass\t`),
    `the writer writes the two rows, every other line byte for byte\n${recorded.stdout}`);

  writeFileSync(fixture, recordOf(real, `${fixed}\tpass\t`, "test/harness/no-such-case.js\tpass\t"));
  const missing = census("test/harness", "--check", fixture, "--paths-from", selection);
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.match(missing.stdout, /no-such-case\.js: recorded, not in the selection/);

  // A case that runs now and fails is pending too, with what it threw: listed, and the run passes.
  const annexB = readFileSync(join(repository, "results/test262/c/annexb.tsv"), "utf8");
  const failing = parseTest262Record(annexB).rows.find(row => row.outcome === "fail");
  assert.ok(failing, "the annexB record holds a fail to take out");
  writeFileSync(selection, `${failing!.path}\n`);
  writeFileSync(fixture, recordOf(annexB));
  const failed = census("test/annexB", "--check", fixture, "--paths-from", selection);
  assert.equal(failed.status, 0, failed.stdout + failed.stderr);
  assert.match(failed.stdout, literally(`${pendingLine(failing!.path, fixture)}: fail: ${failing!.detail}`));
});
