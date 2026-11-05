// Exercise the real consumer with versioned saved observations. No source case
// or checked-in record is mutated; the compiler still runs its own self-checks.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { harnessHashOf } from "./project.ts";
import { parseObservation, parseTypeScriptRecord, serializeTypeScriptRecord, TYPESCRIPT_OBSERVATIONS_VERSION, type TypeScriptObservation } from "./typescript-record.ts";
import { OUTPUT_PREFIX_VERSION } from "../conformance/output-prefix.ts";
import { publishPin, provenanceOf } from "../conformance/pin.ts";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const binary = resolve(repository, process.env.NTS_BIN ?? "target/release/nts");
const pass: TypeScriptObservation = { kind: "pass" };
const wrong: TypeScriptObservation = { kind: "wrong", errorClass: "Test262Error",
  failure: { exit: 1, signal: null, output: "uncaught Test262Error: Expected 7, got 8" } };
const refused: TypeScriptObservation = { kind: "refused", diagnostics: [{ code: "NTS1001", where: "body" }] };
const invalid: TypeScriptObservation = { kind: "invalid-hir", validator: "CallArgumentType { expected: Float64, found: Erased }" };
const abort: TypeScriptObservation = { kind: "runtime-abort", failure: { exit: null, signal: "SIGABRT", output: "program aborted" } };
const host = (from: string, to: string, frame: number): TypeScriptObservation => ({ kind: "runtime-abort",
  failure: { exit: 1, signal: null, output: `Exception in thread "main" java.lang.ClassCastException: class nts.gen.${from} cannot be cast to class nts.gen.${to}\n\tat nts.gen.Program.method${frame}(Unknown Source)` } });
function row(observed: TypeScriptObservation): object {
  switch (observed.kind) {
    case "pass": return { bucket: "strict-pass" };
    case "wrong": return { bucket: "threw", thrown: observed.errorClass, runtimeFailure: observed.failure };
    case "wrong-output": return { bucket: "wrong-output", printed: observed.printed, nodeOutput: observed.nodeOutput, runtimeFailure: observed.failure };
    case "refused": return { bucket: "unsupported", why: "lowering", first: "test refusal", named: [],
      diagnostics: observed.diagnostics.map(d => ({ ...d, message: "test refusal", raw: "test refusal", named: [] })) };
    case "invalid-hir": return { bucket: "invalid-hir", validatorError: observed.validator };
    case "runtime-abort": return { bucket: "crash", runtimeFailure: observed.failure };
    case "build-failure": return observed.stage === "compiler-crash"
      ? { bucket: "crash", why: "emit", buildDiagnostic: observed.diagnostic }
      : { bucket: "unsupported", why: observed.stage, buildDiagnostic: observed.diagnostic };
  }
}

test("the CLI holds every recorded outcome and fails closed before recorded selection", t => {
  assert.ok(existsSync(binary), `compiler missing: ${binary}; set NTS_BIN to a built pin`);
  const base = join(homedir(), ".cache/nts/typescript-record-cli-tests");
  mkdirSync(base, { recursive: true });
  const scratch = mkdtempSync(join(base, "t-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const sourceRoot = repository, fixture = join(scratch, "fixture"), census = join(fixture, "tooling/census");
  mkdirSync(census, { recursive: true });
  for (const name of readdirSync(join(sourceRoot, "tooling/census"))) {
    const from = join(sourceRoot, "tooling/census", name), to = join(census, name);
    if (name === "conformance262.ts") copyFileSync(from, to); else symlinkSync(from, to);
  }
  for (const name of readdirSync(join(sourceRoot, "tooling"))) if (name !== "census")
    symlinkSync(join(sourceRoot, "tooling", name), join(fixture, "tooling", name));
  const familyPath = "tests/typescript/record-protocol";
  mkdirSync(join(fixture, familyPath), { recursive: true });
  const fixturePaths = ["control", "subject"].map(name => `${familyPath}/${name}.ts`);
  for (const path of fixturePaths) writeFileSync(join(fixture, path), "assert.sameValue(1 + 1, 2);\n");
  const git = (args: string[], cwd = fixture) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr); return result.stdout.trim();
  };
  git(["init", "--quiet"]); git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
  git(["add", "tests"]); git(["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "two-case record fixture"]);
  const prior = provenanceOf(binary);
  const pinned = publishPin(binary, join(scratch, "pin"), prior ?? {
    sha: git(["rev-parse", "HEAD"], sourceRoot), subject: "test fixture copy of the gate compiler", clean: true, applied: null,
    built_at: new Date().toISOString(),
  });
  const root = fixture;
  const recorded = { metadata: { version: 3 as const, backend: "c" as const, commit: provenanceOf(pinned).sha,
    compiler: createHash("sha256").update(readFileSync(pinned)).digest("hex").slice(0, 16),
    harness: harnessHashOf("ts"), under: "tests/typescript" }, cases: new Map(fixturePaths.map(path => [path, pass])) };
  const target = [...recorded.cases.keys()][0];
  const fingerprint = createHash("sha256").update(readFileSync(binary)).digest("hex").slice(0, 16);
  const one = join(scratch, "one.tsv"), expected = join(scratch, "expected.tsv"), rows = join(scratch, "rows.jsonl"), json = join(scratch, "report.json");
  writeFileSync(one, serializeTypeScriptRecord({ metadata: recorded.metadata, cases: new Map([[target, pass]]) }));
  const meminfo=join(scratch,"low-meminfo");
  writeFileSync(meminfo,"MemAvailable: 0 kB\n");
  function invoke(contents: string, observed: object, observations = TYPESCRIPT_OBSERVATIONS_VERSION, lowMemory = false) {
    writeFileSync(expected, contents);
    writeFileSync(rows, JSON.stringify({ fingerprint, under: "tests/typescript", harness: harnessHashOf("ts"), observations, output_prefix: OUTPUT_PREFIX_VERSION }) + "\n" +
      JSON.stringify({ path: target, ...observed }) + "\n");
    rmSync(json, { force: true });
    return spawnSync(process.execPath, ["tooling/census/conformance262.ts", "--suite", "typescript", "--backend", "c",
      "--check", expected, "--paths-from", one, "--sample", "1", "--jobs", "1", "--rows", rows, "--resume", "--json", json],
      { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, NTS_BIN: pinned, NTS_CENSUS_DIR: join(scratch, "run"),
          ...(lowMemory?{NTS_MEMINFO:meminfo,NTS_CENSUS_MIN_AVAILABLE_GB:"1000000"}:{}) } });
  }
  for (const [before, after, word, status] of [
    [pass, wrong, "REGRESSED", 1], [refused, wrong, "CHANGED", 1], [invalid, abort, "CHANGED", 1],
    [wrong, { ...wrong, failure: { ...wrong.failure, output: wrong.failure.output + "9" } }, "CHANGED", 1],
    [wrong, refused, "REFUSES NOW", 0], [invalid, pass, "FIXED", 0], [refused, refused, "reproduces", 0],
    [host("Cell$29$", "Type27", 42), host("Cell$39$", "Type37", 52), "reproduces", 0],
    [host("Cell$29$", "Type27", 42), host("Tuple25", "Type37", 52), "CHANGED", 1],
  ] as const) {
    const cases = new Map(recorded.cases);
    cases.set(target, before);
    const result = invoke(serializeTypeScriptRecord({ metadata: recorded.metadata, cases }), row(after));
    assert.equal(result.status, status, result.stdout + result.stderr);
    const report = JSON.parse(readFileSync(json, "utf8"));
    assert.equal(report.record_version, 3);
    assert.deepEqual(report.observations[target], parseObservation(after));
    assert.equal(report.comparison[word]?.length ?? 0, word === "reproduces" ? 0 : 1);
  }
  for (const stage of ["emit", "link", "compiler-crash"] as const) {
    const failure: TypeScriptObservation = { kind: "build-failure", stage, diagnostic: "error: invalid generated operand" };
    const cases = new Map(recorded.cases); cases.set(target, failure);
    const contents = serializeTypeScriptRecord({ metadata: recorded.metadata, cases });
    const reproduced = invoke(contents, row(failure));
    assert.equal(reproduced.status, 0, reproduced.stdout + reproduced.stderr);
    assert.deepEqual(JSON.parse(readFileSync(json, "utf8")).observations[target], failure);
    const fixed = invoke(contents, row(pass));
    assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
    assert.equal(JSON.parse(readFileSync(json, "utf8")).comparison.FIXED.length, 1);
    const changed = invoke(contents, row({ ...failure, diagnostic: "error: different generated operand" }));
    assert.equal(changed.status, 1, changed.stdout + changed.stderr);
    assert.equal(JSON.parse(readFileSync(json, "utf8")).comparison.CHANGED.length, 1);
  }
  const withRefusal = new Map(recorded.cases);
  withRefusal.set(target, refused);
  const reworded = row(refused) as { diagnostics: { message: string; raw: string }[] };
  reworded.diagnostics[0].message = "reworded reason Queue<35>";
  reworded.diagnostics[0].raw = "reworded reason Queue<35>";
  const held = invoke(serializeTypeScriptRecord({ metadata: recorded.metadata, cases: withRefusal }), reworded);
  assert.equal(held.status, 0, held.stdout + held.stderr);
  assert.deepEqual(JSON.parse(readFileSync(json, "utf8")).observations[target], refused);
  const checkerRefusal: TypeScriptObservation = { kind: "refused", diagnostics: [{ code: "TS2322", where: "body" }] };
  const changedCode = invoke(serializeTypeScriptRecord({ metadata: recorded.metadata, cases: withRefusal }), row(checkerRefusal));
  assert.equal(changedCode.status, 1, changedCode.stdout + changedCode.stderr);
  assert.equal(JSON.parse(readFileSync(json, "utf8")).comparison.CHANGED.length, 1);
  const withValidator = new Map(recorded.cases);
  withValidator.set(target, { kind: "invalid-hir", validator: "Queue<35>#push TypeId(42) type 43 at: 7" });
  const shifted = invoke(serializeTypeScriptRecord({ metadata: recorded.metadata, cases: withValidator }),
    { bucket: "invalid-hir", validatorError: "Queue<45>#push TypeId(52) type 53 at: 7" });
  assert.equal(shifted.status, 0, shifted.stdout + shifted.stderr);
  assert.equal(JSON.parse(readFileSync(json, "utf8")).observations[target].validator, "Queue<N>#push TypeId(N) type N at: 7");
  const contents = serializeTypeScriptRecord(recorded);
  const resumed=invoke(contents,row(pass),TYPESCRIPT_OBSERVATIONS_VERSION,true);
  assert.equal(resumed.status,0,resumed.stdout+resumed.stderr);
  assert.deepEqual(JSON.parse(readFileSync(json,"utf8")).observations[target],pass);
  assert.doesNotMatch(resumed.stderr,/memory:|waiting for|holding new cases/);
  assert.match(resumed.stdout,/needed 0 to start/);

  for (const [mutated, message] of [
    [contents.split("\n").filter(line => !line.startsWith(target + "\t")).join("\n"), "new case has no record"],
    [contents + "tests/typescript/missing-source.ts\t{\"kind\":\"pass\"}\n", "recorded case gone missing"],
    [contents + contents.split("\n")[1] + "\n", "duplicate recorded case"],
    [contents.replace(/"version":[23]/, '"version":99'), "unsupported TypeScript record version"],
  ]) {
    const result = invoke(mutated, row(pass));
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.ok((result.stdout + result.stderr).includes(message), result.stdout + result.stderr);
    assert.equal(existsSync(json), false, "an unmeasured run must not publish a report");
  }
  const unmeasured = invoke(contents, { bucket: "timeout" });
  assert.equal(unmeasured.status, 2, unmeasured.stdout + unmeasured.stderr);
  assert.equal(existsSync(json), false, "a timeout cannot become an expected result");
  for (const observed of [{ bucket: "memory-cap", why: "emit resident scope" },
    { bucket: "infrastructure-error", why: "the toolchain did not survive the link" }]) {
    const stopped = invoke(contents, observed);
    assert.equal(stopped.status, 2, stopped.stdout + stopped.stderr);
    assert.equal(existsSync(json), false, "a failed instrument cannot publish a measured report");
  }
  const oldRows = invoke(contents, row(pass), TYPESCRIPT_OBSERVATIONS_VERSION - 1);
  assert.equal(oldRows.status, 2, oldRows.stdout + oldRows.stderr);
  assert.equal(existsSync(json), false, "old diagnostic locations cannot become a current record");

  // Write a complete real family through --record, then consume that exact
  // file through --recorded, the mode used by typescript-cases. Saved raw
  // observations isolate the record protocol from the compiler defect itself.
  const under = target.slice(0, target.lastIndexOf("/"));
  const family = [...recorded.cases].filter(([path]) => path.startsWith(under + "/"));
  const output = join(scratch, "written.tsv");
  const failure: TypeScriptObservation = { kind: "build-failure", stage: "link", diagnostic: "error: invalid generated operand" };
  const observed = new Map(family); observed.set(target, failure);
  function writeAndRead(mode: "--record" | "--recorded") {
    writeFileSync(rows, JSON.stringify({ fingerprint, under, harness: harnessHashOf("ts"), observations: TYPESCRIPT_OBSERVATIONS_VERSION,
      output_prefix: OUTPUT_PREFIX_VERSION }) + "\n" + [...observed].map(([path, value]) => JSON.stringify({ path, ...row(value) })).join("\n") + "\n");
    return spawnSync(process.execPath, ["tooling/census/conformance262.ts", "--suite", "typescript", "--backend", "c",
      "--under", under, mode, output, "--jobs", "1", "--rows", rows, "--resume"],
      { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, NTS_BIN: pinned, NTS_CENSUS_DIR: join(scratch, "writer") } });
  }
  const written = writeAndRead("--record");
  assert.equal(written.status, 0, written.stdout + written.stderr);
  assert.deepEqual(parseTypeScriptRecord(readFileSync(output, "utf8")).cases.get(target), failure);
  const reproduced = writeAndRead("--recorded");
  assert.equal(reproduced.status, 0, reproduced.stdout + reproduced.stderr);
  assert.match(reproduced.stdout, /reconciled/);
  const bare = join(scratch, "non-pin"); mkdirSync(bare); copyFileSync(binary, join(bare, "nts"));
  const unpinned = spawnSync(process.execPath, ["tooling/census/conformance262.ts", "--suite", "typescript", "--under", under,
    "--record", join(scratch, "must-not-publish.tsv")], { cwd: root, encoding: "utf8",
    env: { ...process.env, NTS_BIN: join(bare, "nts"), NTS_CENSUS_DIR: join(scratch, "negative") } });
  assert.equal(unpinned.status, 2, unpinned.stdout + unpinned.stderr);
  assert.match(unpinned.stdout, /not a pin/);
  assert.equal(existsSync(join(scratch, "must-not-publish.tsv")), false);
});
