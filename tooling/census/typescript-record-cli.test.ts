import {fixtureEnvironment} from "../gate/test-environment.ts";
// Exercise the real consumer with versioned saved observations. No source case
// or checked-in record is mutated; the compiler still runs its own self-checks.
import assert from "node:assert/strict";
import {execFileSync, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, appendFileSync, cpSync, lstatSync} from "node:fs";

import {join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {test} from "node:test";
import {harnessHashOf} from "./project.ts";
import {parseObservation, parseTypeScriptRecord, serializeTypeScriptRecord, TYPESCRIPT_OBSERVATIONS_VERSION, type TypeScriptObservation} from "./typescript-record.ts";
import {OUTPUT_PREFIX_VERSION} from "../conformance/output-prefix.ts";
import {typescriptOracleIdentity} from "./suites/typescript.ts";
import {publishPin, provenanceOf} from "../conformance/pin.ts";
import {newTestScratch} from "../gate/test-scratch.ts";
import {ownMemoryEnv} from "../gate/test-memory.ts";
import {removable} from "../gate/run-temporary.ts";

import {setupOracleTestEnvironment} from '../differential/oracle-test-fixture.ts';

await setupOracleTestEnvironment();

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
    case "oracle-rejected": return {bucket:"oracle-rejected",why:observed.error,rejection:{exit:observed.exit,error:observed.error}};
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

test("the CLI holds every recorded outcome and fails closed before recorded selection", async t => {
  assert.ok(existsSync(binary), `compiler missing: ${binary}; set NTS_BIN to a built pin`);
  const scratch = newTestScratch("typescript-record-cli");t.after(()=>{removable(scratch);rmSync(scratch,{recursive:true,force:true});});
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
    const result = spawnSync("git", args, {env:fixtureEnvironment(t), cwd, encoding: "utf8" });
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
  const sourceOracle = typescriptOracleIdentity();
  const one = join(scratch, "one.tsv"), expected = join(scratch, "expected.tsv"), rows = join(scratch, "rows.jsonl"), json = join(scratch, "report.json"),instrumentFile=join(scratch,'instrument.json');
  writeFileSync(one, serializeTypeScriptRecord({ metadata: recorded.metadata, cases: new Map([[target, pass]]) }));
  // A ledger and a reading of the run's own, never the machine's. The
  // starved machine has 1 GiB and none of it available: a request for any
  // memory could never fit beside the ledger's 2 GiB floor, so it would fail
  // the run at once.
  const memory=join(scratch,"memory"),starved=join(scratch,"starved-memory");
  function invoke(contents: string, observed: object, observations = TYPESCRIPT_OBSERVATIONS_VERSION,
    oracleIdentity: ReturnType<typeof typescriptOracleIdentity> | null = sourceOracle, consumerRoot=root, lowMemory=false) {
    writeFileSync(expected, contents);
    writeFileSync(rows, JSON.stringify({ fingerprint, under: "tests/typescript", harness: harnessHashOf("ts"), observations,
      ...(oracleIdentity === null ? {} : { oracleIdentity }), output_prefix: OUTPUT_PREFIX_VERSION }) + "\n" +
      JSON.stringify({ path: target, ...observed }) + "\n");
    rmSync(json, { force: true });
    rmSync(instrumentFile,{force:true});
    process.stderr.write(`record CLI control: ${JSON.stringify({observations, observed, lowMemory})}\n`);
    return spawnSync(process.execPath, ["tooling/census/conformance262.ts", "--suite", "typescript", "--backend", "c",
      "--check", expected, "--paths-from", one, "--sample", "1", "--jobs", "1", "--rows", rows, "--resume", "--json", json],
      { cwd: consumerRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
        env: ownMemoryEnv(lowMemory?starved:memory, { ...fixtureEnvironment(t), NTS_BIN: pinned, NTS_CENSUS_DIR: join(scratch, "run"),
          NTS_GATE_STEP:'typescript-cases',NTS_GATE_STEP_ATTEMPT:'oracle-record-control',NTS_GATE_STEP_RESULT:instrumentFile },
          lowMemory?{availableKiB:0,totalKiB:2**20}:undefined) });
  }
  for (const [before, after, word, status] of [
    [pass, wrong, "REGRESSED", 1], [refused, wrong, "REGRESSED", 1], [invalid, abort, "CHANGED", 1],
    [wrong, abort, "LOUD NOW", 0], [abort, wrong, "REGRESSED", 1],
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
    assert.equal(report.record_version, TYPESCRIPT_OBSERVATIONS_VERSION);
    assert.deepEqual(report.oracleIdentity, sourceOracle);
    assert.deepEqual(report.observations[target], parseObservation(after));
    assert.equal(report.comparison[word]?.length ?? 0, word === "reproduces" ? 0 : 1);
    if (word === "FIXED" || word === "REFUSES NOW" || word === "LOUD NOW") assert.ok(result.stdout.includes(`improved, record pending: ${target} `), result.stdout);
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
  assert.equal(changedCode.status, 0, changedCode.stdout + changedCode.stderr);
  assert.equal(JSON.parse(readFileSync(json, "utf8")).comparison["REFUSES DIFFERENTLY"].length, 1, "a refusal for other reasons is accepted");
  assert.ok(changedCode.stdout.includes(`refuses differently, record pending: ${target} `), changedCode.stdout);
  const withValidator = new Map(recorded.cases);
  withValidator.set(target, { kind: "invalid-hir", validator: "Queue<35>#push TypeId(42) type 43 at: 7" });
  const shifted = invoke(serializeTypeScriptRecord({ metadata: recorded.metadata, cases: withValidator }),
    { bucket: "invalid-hir", validatorError: "Queue<45>#push TypeId(52) type 53 at: 7" });
  assert.equal(shifted.status, 0, shifted.stdout + shifted.stderr);
  assert.equal(JSON.parse(readFileSync(json, "utf8")).observations[target].validator, "Queue<N>#push TypeId(N) type N at: 7");
  const contents = serializeTypeScriptRecord(recorded);
  const resumed=invoke(contents,row(pass),TYPESCRIPT_OBSERVATIONS_VERSION,sourceOracle,root,true);
  assert.equal(resumed.status,0,resumed.stdout+resumed.stderr);
  assert.deepEqual(JSON.parse(readFileSync(json,"utf8")).observations[target],pass);
  assert.doesNotMatch(resumed.stderr,/memory:|waiting for|holding new cases/);
  assert.equal(existsSync(join(starved,"ledger")),false,"a fully resumed run asks the memory ledger for nothing");

  // A case the record has no row for is pending: listed, and not a failure.
  const pending = invoke(contents.split("\n").filter(line => !line.startsWith(target + "\t")).join("\n"), row(pass));
  assert.equal(pending.status, 0, pending.stdout + pending.stderr);
  assert.ok(pending.stdout.includes(`pending: ${target} is not recorded in ${expected} yet`), pending.stdout);
  assert.equal(JSON.parse(readFileSync(json, "utf8")).comparison.pending.length, 1);
  // The compiler is unchanged in every arm. Old rows must not bypass a new
  // source oracle or a changed single-case materialization contract.
  const changedOracleIdentity = structuredClone(sourceOracle);
  changedOracleIdentity.oracle.emitterSha256 = "0".repeat(64);
  const changedRoots = structuredClone(sourceOracle);
  changedRoots.materializer.roots = ["src/main.ts"];
  for (const identity of [null, changedOracleIdentity, changedRoots]) {
    const result = invoke(contents, row(pass), TYPESCRIPT_OBSERVATIONS_VERSION, identity);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /missing or different TypeScript oracle identity/);
    assert.equal(existsSync(json), false, "changed-oracle rows cannot publish a run artifact");
    assert.equal(readFileSync(rows, "utf8").trim().split("\n").length, 2, "rejected resume leaves its checkpoint intact");
  }
  // Change the actual adapter bytes, rather than only a synthetic header hash.
  // The copied production consumer and its one identity function own both arms.
  const copied=join(scratch,'copied-consumer');mkdirSync(copied);
  cpSync(join(sourceRoot,'tooling'),join(copied,'tooling'),{recursive:true,verbatimSymlinks:true});
  for(const file of ['package.json','.tool-versions','tsconfig.fixtures.json'])cpSync(join(sourceRoot,file),join(copied,file));
  symlinkSync(join(sourceRoot,'node_modules'),join(copied,'node_modules'),'dir');
  symlinkSync(join(root,'tests'),join(copied,'tests'),'dir');
  symlinkSync(join(sourceRoot,'third_party'),join(copied,'third_party'),'dir');
  symlinkSync(join(sourceRoot,'runtime'),join(copied,'runtime'),'dir');
  // The real report records its consumer repository's HEAD. Bind the actual
  // copied files in this isolated fixture, without borrowing the author's Git.
  execFileSync('git',['init','--quiet',copied], {env:fixtureEnvironment(t)});
  execFileSync('git',['-C',copied,'add','--','tooling','package.json','.tool-versions','tsconfig.fixtures.json','node_modules','tests','third_party','runtime'], {env:fixtureEnvironment(t)});
  execFileSync('git',['-C',copied,'-c','user.name=nts fixture','-c','user.email=fixture@invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null','commit','--quiet','-m','Bind copied oracle consumer inputs'], {env:fixtureEnvironment(t)});
  const unchangedAdapter=invoke(contents,row(pass),TYPESCRIPT_OBSERVATIONS_VERSION,sourceOracle,copied);
  assert.equal(unchangedAdapter.status,0,unchangedAdapter.stdout+unchangedAdapter.stderr);
  assert.deepEqual(JSON.parse(readFileSync(json,'utf8')).oracleIdentity,sourceOracle);
  assert.ok(lstatSync(join(copied,'tooling/differential')).isDirectory(),'the adapter mutation owns a physical copy');
  appendFileSync(join(copied,'tooling/census/typescript-oracle-results.ts'),'\n// changed adapter bytes in the resume control\n');
  const changedAdapter=invoke(contents,row(pass),TYPESCRIPT_OBSERVATIONS_VERSION,sourceOracle,copied);
  assert.equal(changedAdapter.status,2,changedAdapter.stdout+changedAdapter.stderr);
  assert.match(changedAdapter.stdout+changedAdapter.stderr,/missing or different TypeScript oracle identity/);
  assert.equal(existsSync(json),false,'changed adapter cannot publish a run artifact');
  assert.equal(readFileSync(rows,'utf8').trim().split('\n').length,2,'changed adapter leaves the checkpoint intact');
  for (const [mutated, message] of [
    [contents + "tests/typescript/missing-source.ts\t{\"kind\":\"pass\"}\n", "recorded case gone missing"],
    [contents + contents.split("\n")[1] + "\n", "duplicate recorded case"],
    [contents.replace(/"version":[234]/, '"version":99'), "unsupported TypeScript record version"],
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
    await t.test(`failed instrument ${observed.bucket}`, () => {
      const stopped = invoke(contents, observed);
      assert.equal(stopped.status, 2, stopped.stdout + stopped.stderr);
      assert.equal(existsSync(json), false, "a failed instrument cannot publish a measured report");
    });
  }
  const oldRows = invoke(contents, row(pass), TYPESCRIPT_OBSERVATIONS_VERSION - 1);
  assert.equal(oldRows.status, 2, oldRows.stdout + oldRows.stderr);
  assert.match(oldRows.stdout + oldRows.stderr, /versioned raw observations/);
  assert.equal(existsSync(json), false, "old diagnostic locations cannot become a current record");

  const rejected:TypeScriptObservation={kind:'oracle-rejected',exit:1,error:'Test262Error: sameValue'};
  const beforeCases=new Map(recorded.cases);beforeCases.set(target,wrong);
  const changedOracle=invoke(serializeTypeScriptRecord({metadata:recorded.metadata,cases:beforeCases}),row(rejected));
  assert.equal(changedOracle.status,1,changedOracle.stdout+changedOracle.stderr);
  assert.equal(JSON.parse(readFileSync(json,'utf8')).comparison.CHANGED.length,1);
  const rejectedCases=new Map(recorded.cases);rejectedCases.set(target,rejected);
  const rejectedContents=serializeTypeScriptRecord({metadata:{...recorded.metadata,version:4},cases:rejectedCases});
  const oracleReproduction=invoke(rejectedContents,row(rejected));
  assert.equal(oracleReproduction.status,0,oracleReproduction.stdout+oracleReproduction.stderr);
  const reproducedReport=JSON.parse(readFileSync(json,'utf8'));
  assert.deepEqual(reproducedReport.observations[target],rejected);
  assert.equal(reproducedReport.outcomes[target]?.outcome,'no-verdict');
  await t.test('a stopped oracle keeps the typed CLI instrument contract', () => {
    const instrument=invoke(rejectedContents,{bucket:'oracle',why:'loader failed'});
    assert.match(instrument.stdout+instrument.stderr,/ToolingInstrumentError|oracle not measured/);
    assert.equal(existsSync(json),false,'a loader failure cannot satisfy an expected rejection');
    const heldInstrument=JSON.parse(readFileSync(instrumentFile,'utf8'));
    assert.equal(heldInstrument.kind,'tooling-setup');assert.equal(heldInstrument.verdict,'INSTRUMENT');
    t.diagnostic('oracle-stop-proof '+JSON.stringify({status:instrument.status,kind:heldInstrument.kind,verdict:heldInstrument.verdict,reportExists:existsSync(json)}));
    assert.equal(instrument.status,2,instrument.stdout+instrument.stderr);
  });

  // Write a complete real family through --record, then consume that exact
  // file through --recorded, the mode each typescript-<backend> step uses. Saved raw
  // observations isolate the record protocol from the compiler defect itself.
  const under = target.slice(0, target.lastIndexOf("/"));
  const family = [...recorded.cases].filter(([path]) => path.startsWith(under + "/"));
  const output = join(scratch, "written.tsv");
  const failure: TypeScriptObservation = { kind: "build-failure", stage: "link", diagnostic: "error: invalid generated operand" };
  const observed = new Map(family); observed.set(target, failure);
  function run(mode: "--record" | "--recorded" | "--record-pending", file: string, saved: ReadonlyMap<string, TypeScriptObservation>, extra: string[] = []) {
    writeFileSync(rows, JSON.stringify({ fingerprint, under, harness: harnessHashOf("ts"), observations: TYPESCRIPT_OBSERVATIONS_VERSION,
      oracleIdentity: sourceOracle, output_prefix: OUTPUT_PREFIX_VERSION }) + "\n" + [...saved].map(([path, value]) => JSON.stringify({ path, ...row(value) })).join("\n") + "\n");
    return spawnSync(process.execPath, ["tooling/census/conformance262.ts", "--suite", "typescript", "--backend", "c",
      "--under", under, mode, file, "--jobs", "1", "--rows", rows, "--resume", ...extra],
      { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
        env: { ...fixtureEnvironment(t), NTS_BIN: pinned, NTS_CENSUS_DIR: join(scratch, "writer") } });
  }
  const written = run("--record", output, observed);
  assert.equal(written.status, 0, written.stdout + written.stderr);
  assert.deepEqual(parseTypeScriptRecord(readFileSync(output, "utf8")).cases.get(target), failure);
  const reproduced = run("--recorded", output, observed);
  assert.equal(reproduced.status, 0, reproduced.stdout + reproduced.stderr);
  assert.match(reproduced.stdout, /reconciled/);

  // The gate's mode, with a case the record has no row for yet: pending, listed and not run.
  const other = family.map(([path]) => path).find(path => path !== target)!;
  const partial = join(scratch, "partial.tsv");
  writeFileSync(partial, readFileSync(output, "utf8").split("\n").filter(line => !line.startsWith(other + "\t")).join("\n"));
  const gate = run("--recorded", partial, observed, ["--json", json]);
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  assert.ok(gate.stdout.includes(`pending: ${other} is not recorded in ${partial} yet`), gate.stdout);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(json, "utf8")).observations), [target], "a pending case is not measured at landing");
  // The full check's writer: the pending row and the improved one, every other line byte for byte.
  const header = readFileSync(partial, "utf8").split("\n")[0];
  const better = new Map(observed); better.set(target, pass);
  const recordedPending = run("--record-pending", partial, better);
  assert.equal(recordedPending.status, 0, recordedPending.stdout + recordedPending.stderr);
  assert.match(recordedPending.stdout, /recorded 2 pending or improved row\(s\)/);
  const after = readFileSync(partial, "utf8");
  assert.equal(after.split("\n")[0], header, "the header is kept");
  assert.deepEqual(parseTypeScriptRecord(after).cases, new Map([[target, pass], [other, observed.get(other)!]]));
  assert.equal(run("--record-pending", partial, better).status, 0);
  assert.equal(readFileSync(partial, "utf8"), after, "nothing pending or improved changes nothing");
  const worse = new Map(better); worse.set(target, wrong);
  const blocked = run("--record-pending", partial, worse);
  assert.equal(blocked.status, 1, blocked.stdout + blocked.stderr);
  assert.match(blocked.stdout, /REGRESSED[\s\S]*not recorded/, "a regression still fails, and blocks the write");
  assert.equal(readFileSync(partial, "utf8"), after);

  const bare = join(scratch, "non-pin"); mkdirSync(bare); copyFileSync(binary, join(bare, "nts"));
  for (const [writer, file] of [["--record", join(scratch, "must-not-publish.tsv")], ["--record-pending", partial]]) {
    const unpinned = spawnSync(process.execPath, ["tooling/census/conformance262.ts", "--suite", "typescript", "--under", under,
      writer, file], { cwd: root, encoding: "utf8",
      env: { ...fixtureEnvironment(t), NTS_BIN: join(bare, "nts"), NTS_CENSUS_DIR: join(scratch, "negative") } });
    assert.equal(unpinned.status, 2, unpinned.stdout + unpinned.stderr);
    assert.match(unpinned.stdout, /not a pin/);
  }
  assert.equal(existsSync(join(scratch, "must-not-publish.tsv")), false);
  assert.equal(readFileSync(partial, "utf8"), after);
});
