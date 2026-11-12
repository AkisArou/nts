import {fixtureEnvironment} from "../gate/test-environment.ts";
import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { publishPin } from "../conformance/pin.ts";
import { FIXED_AMBIENT, gateEnvironment, ENVIRONMENT_CONTEXT } from "../gate/canonical-environment.ts";
import { testScratch } from "../gate/test-scratch.ts";
import { ownMemory, withoutHanded } from "../gate/test-memory.ts";

/** The record the compile checks name in their lines; the comparison itself never reads it. */
const RECORD_FILE = "results/benchmarks/c/outcomes.tsv";

test("compile children use the canonical ambient environment and retain its owned handoff", async t => {
  const { compileEnvironment } = await import("./compile-producer.ts");
  const root = testScratch(t, "benchmark-record-environment");
  const home = join(root, "home"); mkdirSync(home);
  const launcher = { PATH: process.env.PATH, HOME: home, DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    NODE_OPTIONS: "--trace-warnings", LD_PRELOAD: "/shell/not-an-input.so", FORCE_COLOR: "3", TZ: "Pacific/Honolulu", CFLAGS: "-Dbad", NTS_RC_NAIVE: "1" };
  const raw = compileEnvironment(launcher, root, "/compiler/nts");
  for (const [key, value] of Object.entries(FIXED_AMBIENT)) assert.equal(raw[key], value);
  for (const key of ["NODE_OPTIONS", "LD_PRELOAD", "CFLAGS", "NTS_RC_NAIVE"]) assert.equal(raw[key], undefined);
  assert.equal(raw.TMPDIR, join(root, "tmp")); assert.equal(raw.NTS_BIN, "/compiler/nts"); assert.equal(raw.NTS_CHECKERS, "1");
  const canonical = gateEnvironment(launcher, { run: root, owned: { NTS_GATE_STEP_SLICE: "owned-step.slice" } });
  const inherited = compileEnvironment(canonical.env, join(root, "unused"), "/compiler/other");
  assert.equal(inherited.NTS_GATE_STEP_SLICE, "owned-step.slice"); assert.equal(inherited.NTS_BIN, "/compiler/other");
  assert.equal(inherited.TMPDIR, canonical.env.TMPDIR);
  assert.equal(inherited.DBUS_SESSION_BUS_ADDRESS, launcher.DBUS_SESSION_BUS_ADDRESS);
  assert.ok(inherited[ENVIRONMENT_CONTEXT]);
});

test("compile observations retain defects and reject incomplete instruments", async () => {
  const { compileOutcome } = await import("./compile-producer.ts");
  const completed = (status = 0, stderr = "") => ({ status, signal: null, stdout: "", stderr, out: stderr, elapsedMs: 1 });
  assert.deepEqual(compileOutcome(completed(), "emit"), null);
  assert.deepEqual(compileOutcome({ ...completed(), stdout: 'NTS4001: out of memory', out: 'NTS4001: out of memory' }, "emit"), null,
    "generated code containing diagnostic-shaped data is not a compiler diagnostic");
  assert.deepEqual(compileOutcome(completed(0, "declined: NTS4001 shape at /scratch/case.ts:42"), "emit"),
    { kind: "refused", diagnostic: "declined: NTS4001 shape at <path>" });
  assert.equal(compileOutcome(completed(0, "NTS1001 property panicked is not supported"), "emit")?.kind, "refused", "a source name cannot hide a refusal");
  assert.deepEqual(compileOutcome(completed(1, "error: /scratch/program.c:21: invalid operand 37"), "link"),
    { kind: "build-failure", stage: "link", diagnostic: "error: <path> invalid operand N" });
  assert.deepEqual(compileOutcome(completed(101, "NTS1001 an earlier refusal\nthread 'main' (24) panicked at /compiler/foo.rs:17:3:\nbroken route\n"), "emit"),
    { kind: "build-failure", stage: "compiler-crash", diagnostic: "thread 'main' panicked: broken route" });
  assert.deepEqual(compileOutcome({ ...completed(), status: null, signal: "SIGABRT" }, "emit"),
    { kind: "build-failure", stage: "compiler-crash", diagnostic: "stopped by SIGABRT" });
  assert.throws(() => compileOutcome({ ...completed(), status: null, signal: "SIGABRT" }, "link"), /NOT MEASURED/);
  for (const result of [{ ...completed(), signal: "SIGKILL", status: null }, { ...completed(137) },
    { ...completed(1), memoryKilled: true }, completed(1, "the toolchain did not survive"),
    { ...completed(1), error: new Error("spawn failed") }, { ...completed(1), hung: "idle guard" }]) {
    assert.throws(() => compileOutcome(result, "emit"), /NOT MEASURED/);
  }
});

test("the compile CLI records one compile at a time and four at once alike, checks changed outcomes, and refuses non-pins and resource stops", async t => {
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  const scratch = testScratch(t, "benchmark-record-cli");
  const root = join(scratch, "fixture"); mkdirSync(join(root, "tooling/bench"), { recursive: true });
  for (const entry of readdirSync(join(repository, "tooling"))) if (entry !== "bench") symlinkSync(join(repository, "tooling", entry), join(root, "tooling", entry));
  for (const entry of readdirSync(join(repository, "tooling/bench"))) {
    if (entry === "build-records.ts") copyFileSync(join(repository, "tooling/bench", entry), join(root, "tooling/bench", entry));
    else symlinkSync(join(repository, "tooling/bench", entry), join(root, "tooling/bench", entry));
  }
  symlinkSync(join(repository, "node_modules"), join(root, "node_modules"));
  writeFileSync(join(root, "tsconfig.fixtures.json"), '{"compilerOptions":{"target":"ESNext","noEmit":true}}');
  for (const name of ["control", "subject", "root-coverage"]) {
    mkdirSync(join(root, "benchmarks/cases", name), { recursive: true });
    writeFileSync(join(root, "benchmarks/cases", name, "case.ts"), "export function run() { return 1; }");
  }
  writeFileSync(join(root, "benchmarks/cases/root-coverage/unimported.ts"), "export const sibling = 1;\n");
  const git = (args: string[]) => {
    const result = spawnSync("git", args, {env:fixtureEnvironment(t), cwd: root, encoding: "utf8" }); assert.equal(result.status, 0, result.stdout + result.stderr); return result.stdout.trim();
  };
  git(["init", "--quiet", "--initial-branch=main"]); git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
  git(["add", "benchmarks", "tsconfig.fixtures.json"]); git(["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "--quiet", "-m", "benchmark recorder fixture"]);
  const binary = join(scratch, "compiler");
  writeFileSync(binary, `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const [mode, project, ...args] = process.argv.slice(2);
const leaked = ['BENCH_SHELL_ONLY', 'NTS_RC_NAIVE'].filter(key => process.env[key]);
if (leaked.length) { console.error('NTS4999: shell-only settings reached the compiler: ' + leaked.join(', ')); process.exit(0); }
const testMode = 'normal';
if (testMode === 'kill') process.kill(process.pid, 'SIGKILL');
if (testMode === 'abort') process.kill(process.pid, 'SIGABRT');
if (testMode === 'crash') { console.error("thread 'main' panicked at /source/compiler.rs:27"); process.exit(101); }
const config = JSON.parse(fs.readFileSync(project, 'utf8'));
if (!config.include[0].endsWith('.ts') && fs.existsSync(path.join(config.include[0], 'unimported.ts'))) {
  console.error('NTS4001: unimported case sibling refused'); process.exit(0);
}
if (config.include[0].includes('/subject/') && testMode !== 'fixed') {
  console.error('NTS4001: unsupported benchmark shape'); process.exit(0);
}
const output = args[args.indexOf('--out') + 1]; fs.mkdirSync(output, {recursive:true});
fs.writeFileSync(path.join(output, mode === 'emit-c' ? 'program.c' : mode === 'emit-llvm' ? 'program.ll' : 'Program.class'),
  mode === 'emit-c' ? 'int control(void) { return 1; }' : mode === 'emit-llvm' ? 'define i32 @control() { ret i32 1 }' : 'class');
`); chmodSync(binary, 0o755);
  const pinned = publishPin(binary, join(scratch, "pin"), { sha: git(["rev-parse", "HEAD"]), clean: true, applied: null });
  // The recorder reserves in a ledger of its own, against a reading of its own.
  const memoryDirectory = join(scratch, "memory"), ample = { availableKiB: 33554432, totalKiB: 64_000_000 };
  const memory = ownMemory(memoryDirectory, ample);
  const first = join(scratch, "first"), second = join(scratch, "second");
  const environment = (env: NodeJS.ProcessEnv, bin = pinned): NodeJS.ProcessEnv => {
    const selected = { ...withoutHanded(fixtureEnvironment(t)), NTS_BIN: bin, ...memory, TMPDIR: scratch, BENCH_SHELL_ONLY: "must be dropped", NTS_RC_NAIVE: "1", ...env };
    delete selected.NTS_GATE_STEP_RESULT; // A planted stop belongs to this fixture, never the outer tooling step.
    delete selected[ENVIRONMENT_CONTEXT]; delete selected.NTS_GATE_RUN_DIR;
    return selected;
  };
  const invoke = (mode: string, output: string, env: NodeJS.ProcessEnv = {}, bin = pinned, extra: string[] = []) => spawnSync(process.execPath,
    ["tooling/bench/build-records.ts", mode, "--output", output, ...extra], { cwd: root, encoding: "utf8", maxBuffer: 8 << 20,
      env: environment(env, bin) });
  const bare = invoke("--record", join(scratch, "bare"), {}, binary);
  assert.equal(bare.status, 124, bare.stdout + bare.stderr); assert.match(bare.stderr, /clean, unpatched pin/);
  assert.equal(existsSync(join(scratch, "bare/c/outcomes.tsv")), false);
  // One compile at a time and four at once write the same rows, byte for byte,
  // and each record holds the other's compiles.
  for (const [output, jobs] of [[first, "1"], [second, "4"]] as const) {
    const result = invoke("--record", output, {}, pinned, ["--jobs", jobs]); assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  for (const backend of ["c", "llvm", "jvm"]) assert.equal(readFileSync(join(first, backend, "outcomes.tsv"), "utf8"), readFileSync(join(second, backend, "outcomes.tsv"), "utf8"));
  for (const [record, jobs] of [[first, "4"], [second, "1"]] as const) {
    const held = invoke("--check", record, {}, pinned, ["--jobs", jobs]); assert.equal(held.status, 0, held.stdout + held.stderr);
    assert.match(held.stdout, /; 0 changed outcomes, 0 accepted, 0 pending$/m);
  }
  const { parseBenchmarkRecord } = await import("./outcomes.ts");
  const scope = parseBenchmarkRecord(readFileSync(join(first, "c/outcomes.tsv"), "utf8"));
  const control = scope.rows.find(row => row.path.endsWith("/control"))!;
  assert.equal(control.outcome.kind, "pass", `the memory scope resurrected a shell-only compiler setting: ${JSON.stringify(control.outcome)}`);
  assert.equal(scope.rows.find(row => row.path.endsWith("/root-coverage"))!.outcome.kind, "refused",
    "the compile scope retains benches.sh's whole-directory roots, including an unimported sibling");
  const reproduced = invoke("--check", first); assert.equal(reproduced.status, 0, reproduced.stdout + reproduced.stderr);
  function changedCompiler(mode: "fixed" | "kill" | "abort") {
    const source = join(scratch, `${mode}-compiler`); writeFileSync(source, readFileSync(binary, "utf8").replace("const testMode = 'normal';", `const testMode = '${mode}';`)); chmodSync(source, 0o755);
    return publishPin(source, join(scratch, `${mode}-pin`), { sha: git(["rev-parse", "HEAD"]), clean: true, applied: null });
  }
  const fixedPin = changedCompiler("fixed");
  const moved = invoke("--check", first, {}, fixedPin); assert.equal(moved.status, 0, moved.stdout + moved.stderr);
  assert.match(moved.stdout, /^c improved, record pending: benchmarks\/cases\/subject in \S+: \{"kind":"refused".*\} -> \{"kind":"pass"\}$/m, "an improvement passes and is listed");
  const fixedRecord = join(scratch, "fixed-record");
  assert.equal(invoke("--record", fixedRecord, {}, fixedPin).status, 0);
  const regressed = invoke("--check", fixedRecord); assert.equal(regressed.status, 1, regressed.stdout + regressed.stderr);
  assert.match(regressed.stdout, /^c REGRESSED benchmarks\/cases\/subject: /m, "a regression still fails");
  // A copy of a record with one line changed, to hold pending and stale cases.
  const variant = (name: string, edit: (backend: string, text: string) => string) => {
    for (const backend of ["c", "llvm", "jvm"]) {
      mkdirSync(join(scratch, name, backend), { recursive: true });
      writeFileSync(join(scratch, name, backend, "outcomes.tsv"), edit(backend, readFileSync(join(first, backend, "outcomes.tsv"), "utf8")));
    }
    return join(scratch, name);
  };
  const without = (path: string) => (backend: string, text: string) => backend === "c" ? text.split("\n").filter(line => !line.startsWith(path + "\t")).join("\n") : text;
  const waiting = invoke("--check", variant("pending", without("benchmarks/cases/subject")));
  assert.equal(waiting.status, 0, waiting.stdout + waiting.stderr);
  assert.match(waiting.stdout, /^c pending: benchmarks\/cases\/subject is not recorded in \S*pending\/c\/outcomes\.tsv yet$/m);
  assert.doesNotMatch(waiting.stdout, /^c benchmarks\/cases\/subject: /m, "a pending case is not measured at landing");
  assert.match(waiting.stdout, /^llvm benchmarks\/cases\/subject: refused$/m, "a recorded case is");
  // A recorded compile timeout is not measured by a check: compiling only, it
  // cannot get worse, and it would cost its whole bound on every run.
  const timedOut = (backend: string, text: string) => backend === "c" ? text.split("\n").map(line => line.startsWith("benchmarks/cases/control\t")
    ? line.replace('"outcome":{"kind":"pass"}', '"outcome":{"kind":"timeout","stage":"compile"}') : line).join("\n") : text;
  const kept = invoke("--check", variant("timeout", timedOut));
  assert.equal(kept.status, 0, kept.stdout + kept.stderr);
  assert.match(kept.stdout, /^c benchmarks\/cases\/control: timeout, as recorded; a check does not measure it again$/m);
  assert.doesNotMatch(kept.stdout, /^c improved, record pending: benchmarks\/cases\/control /m, "measured, the fake compiler's pass would show");
  assert.match(kept.stdout, /^llvm benchmarks\/cases\/control: pass$/m, "the other backends' rows are measured");
  // The compiles of a case at its bound in some backend's record start first, whatever its path.
  const slowSubject = (backend: string, text: string) => backend === "c" ? text.split("\n").map(line => line.startsWith("benchmarks/cases/subject\t")
    ? line.replace(/"outcome":\{[^}]*\}/, '"outcome":{"kind":"timeout","stage":"compile"}') : line).join("\n") : text;
  const slowFirst = invoke("--check", variant("slow-first", slowSubject), {}, pinned, ["--jobs", "1"]);
  assert.equal(slowFirst.status, 0, slowFirst.stdout + slowFirst.stderr);
  assert.deepEqual(slowFirst.stdout.split("\n").filter(line => /^(?:c|llvm|jvm) benchmarks\/cases\/[\w-]+: [a-z-]+$/.test(line)).slice(0, 2),
    ["llvm benchmarks/cases/subject: refused", "jvm benchmarks/cases/subject: refused"], slowFirst.stdout);
  const staleRow = (backend: string, text: string) => backend === "c" ? text + text.split("\n")[1]!.replace("benchmarks/cases/control", "benchmarks/cases/deleted") + "\n" : text;
  const stale = invoke("--check", variant("stale", staleRow)); assert.equal(stale.status, 124, stale.stdout + stale.stderr);
  assert.match(stale.stderr, /recorded benchmark scope gone missing: benchmarks\/cases\/deleted compile/, "a row whose case is gone still fails");
  // The full check's writer: pending and improved rows only, from a clean pin and a clean comparison.
  const writer = variant("writer", without("benchmarks/cases/root-coverage"));
  const original = Object.fromEntries(["c", "llvm", "jvm"].map(backend => [backend, readFileSync(join(writer, backend, "outcomes.tsv"), "utf8")]));
  const notPinned = invoke("--record-pending", writer, {}, binary); assert.equal(notPinned.status, 124, notPinned.stdout + notPinned.stderr);
  assert.match(notPinned.stderr, /--record-pending requires a clean, unpatched pin/);
  const untouched = readFileSync(join(fixedRecord, "c/outcomes.tsv"), "utf8");
  const blocked = invoke("--record-pending", fixedRecord); assert.equal(blocked.status, 1, blocked.stdout + blocked.stderr);
  assert.match(blocked.stdout, /not recorded: 3 recorded outcome\(s\) changed/, "a regression blocks every write");
  assert.equal(readFileSync(join(fixedRecord, "c/outcomes.tsv"), "utf8"), untouched);
  const recorded = invoke("--record-pending", writer, {}, fixedPin); assert.equal(recorded.status, 0, recorded.stdout + recorded.stderr);
  for (const backend of ["c", "llvm", "jvm"]) {
    const before = original[backend]!.split("\n"), after = readFileSync(join(writer, backend, "outcomes.tsv"), "utf8").split("\n");
    const subject = after.find(line => line.startsWith("benchmarks/cases/subject\t"))!;
    assert.match(subject, /"outcome":\{"kind":"pass"\}/, `${backend}: the improved row is rewritten`);
    const rest = (lines: string[]) => lines.filter(line => !line.startsWith("benchmarks/cases/subject\t") && !(backend === "c" && line.startsWith("benchmarks/cases/root-coverage\t")));
    assert.deepEqual(rest(after), rest(before), `${backend}: every other line stays byte for byte`);
    assert.equal(after.some(line => line.startsWith("benchmarks/cases/root-coverage\t")), true, `${backend}: the pending row is written`);
  }
  const written = Object.fromEntries(["c", "llvm", "jvm"].map(backend => [backend, readFileSync(join(writer, backend, "outcomes.tsv"), "utf8")]));
  const again = invoke("--record-pending", writer, {}, fixedPin); assert.equal(again.status, 0, again.stdout + again.stderr);
  for (const backend of ["c", "llvm", "jvm"]) assert.equal(readFileSync(join(writer, backend, "outcomes.tsv"), "utf8"), written[backend], "nothing pending changes nothing");
  const killed = invoke("--record", join(scratch, "killed"), {}, changedCompiler("kill"));
  assert.equal(killed.status, 124, killed.stdout + killed.stderr); assert.match(killed.stderr, /NOT MEASURED/);
  assert.equal(existsSync(join(scratch, "killed/c/outcomes.tsv")), false, "a killed emitter publishes no record");
  const aborted = invoke("--record", join(scratch, "aborted"), {}, changedCompiler("abort"));
  assert.equal(aborted.status, 0, aborted.stdout + aborted.stderr);
  const crash = parseBenchmarkRecord(readFileSync(join(scratch, "aborted/c/outcomes.tsv"), "utf8")).rows[0]!.outcome;
  assert.equal(crash.kind, "build-failure");
  assert.ok(crash.kind === "build-failure"); assert.equal(crash.stage, "compiler-crash");
  ownMemory(memoryDirectory, { ...ample, availableKiB: 0 });
  const heldOutput = join(scratch, "held"), held = spawn(process.execPath, ["tooling/bench/build-records.ts", "--record", "--backend", "c", "--output", heldOutput],
    { cwd: root, env: environment({}), stdio: ["ignore", "pipe", "pipe"] });
  let observed = "", resumed = false;
  held.stdout.on("data", bytes => { observed += bytes; });
  held.stderr.on("data", bytes => {
    observed += bytes;
    if (!resumed && observed.includes("waits for")) { resumed = true; ownMemory(memoryDirectory, ample); }
  });
  const status = await new Promise<number | null>((resolve, reject) => { held.once("error", reject); held.once("close", resolve); });
  assert.ok(resumed, observed); assert.equal(status, 0, observed);
  assert.ok(existsSync(join(heldOutput, "c/outcomes.tsv")), "a serial recorder stays alive while it waits its turn in the ledger, and then records normally");
  const directories = readdirSync(scratch).filter(name => name.startsWith("compile-")); assert.deepEqual(directories, [], "every run removes its scratch tree");
});

test("recorded compile cells execute every backend and expose outcome movement", async t => {
  const { observeCompile } = await import("./compile-producer.ts");
  const { checkCompileRecord } = await import("./build-records.ts");
  const { serializeBenchmarkRecord, parseBenchmarkRecord } = await import("./outcomes.ts");
  const root = testScratch(t, "benchmark-record-run");
  const path = "benchmarks/cases/control", project = join(root, "tsconfig.json"); writeFileSync(project, "{}");
  const calls: string[][] = [];
  let refused = false;
  const command = async (binary, args) => {
    calls.push([binary, ...args]);
    const output = args[args.indexOf("--out") + 1];
    if (args[0] === "emit-c") { mkdirSync(output, { recursive: true }); writeFileSync(join(output, "program.c"), "/* generated */"); }
    if (args[0] === "emit-llvm") { mkdirSync(output, { recursive: true }); writeFileSync(join(output, "program.ll"), "; IR"); }
    if (args[0] === "emit-jvm") { mkdirSync(output, { recursive: true }); writeFileSync(join(output, "Program.class"), "class bytes"); }
    const stderr = refused && args[0]?.startsWith("emit-") ? "NTS4001: unsupported shape" : "";
    return { status: 0, signal: null, stdout: args[0] === "emit-llvm" ? "; IR" : "", stderr, out: stderr, elapsedMs: 1 };
  };
  for (const backend of ["c", "llvm", "jvm"] as const) {
    const out = join(root, backend);
    assert.deepEqual(await observeCompile({ backend, project, output: out, binary: "nts", root, env: {}, command }), { kind: "pass" });
    if (backend === "llvm") assert.equal(readFileSync(join(out, "program.ll"), "utf8"), "; IR");
    const row = { path, scope: "compile" as const, source: "1".repeat(64), driver: "2".repeat(64), outcome: { kind: "pass" as const } };
    const record = parseBenchmarkRecord(serializeBenchmarkRecord({ metadata: { version: 1, backend, commit: "a".repeat(40), compiler: "b".repeat(16), harness: "c".repeat(16), under: "benchmarks/cases", scopes: ["compile"] }, rows: [row] }));
    assert.deepEqual(checkCompileRecord(record, [row], RECORD_FILE), { changed: [], accepted: [] });
    refused = true;
    const outcome = await observeCompile({ backend, project, output: out, binary: "nts", root, env: {}, command });
    assert.equal(outcome.kind, "refused");
    assert.equal(checkCompileRecord(record, [{ ...row, outcome }], RECORD_FILE).changed.length, 1, "a pass that refuses now is a regression");
    const held = parseBenchmarkRecord(serializeBenchmarkRecord({ ...record, rows: [{ ...row, outcome }] }));
    assert.deepEqual(checkCompileRecord(held, [{ ...row, outcome }], RECORD_FILE), { changed: [], accepted: [] });
    const fixed = checkCompileRecord(held, [row], RECORD_FILE);
    assert.equal(fixed.changed.length, 0, "a fix passes");
    assert.deepEqual(fixed.accepted.map(({ row }) => row), [row], "and is listed for the full check to record");
    const unrecorded = { ...row, path: "benchmarks/cases/new" };
    assert.deepEqual(checkCompileRecord(held, [{ ...row, outcome }, unrecorded], RECORD_FILE), { changed: [], accepted: [] }, "a case with no row is pending");
    refused = false;
  }
  assert.ok(calls.some(row => row[1] === "emit-c" && row.includes("--rc")));
  assert.ok(calls.some(row => row[1] === "emit-llvm" && row.includes("--rc")));
  assert.ok(calls.some(row => row[1] === "emit-jvm"));
  assert.ok(calls.some(row => row.includes("-Werror") && row.includes("-DNTS_PROVIDER_RC")));
  assert.ok(calls.some(row => row.includes("-x") && row.includes("ir")));
});

test("case identities cover resolved options, roots, sources and data independently of config syntax and scratch paths", async t => {
  const { benchmarkIdentities } = await import("./build-records.ts");
  const root = testScratch(t, "benchmark-record-identity");
  const a = "benchmarks/cases/control", b = "benchmarks/cases/subject";
  for (const path of [a, b, "benchmarks/common", "scratch-a", "scratch-b"]) mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, "tsconfig.fixtures.json"), JSON.stringify({ compilerOptions: { target: "ESNext", noEmit: true } }));
  writeFileSync(join(root, a, "case.ts"), "export function run() { return 1; }");
  writeFileSync(join(root, b, "case.ts"), "import { input } from '../../common/input.ts'; export function run() { return input; }");
  writeFileSync(join(root, "benchmarks/common/input.ts"), "export const input = 1;");
  writeFileSync(join(root, b, "data.txt"), "data one");
  const identity = () => benchmarkIdentities(root, [a, b], join(root, "scratch-a"));
  const original = await identity();
  assert.deepEqual(await benchmarkIdentities(root, [b, a], join(root, "scratch-b")), new Map([...original].reverse()));
  const base = join(root, "tsconfig.fixtures.json");
  // These are paths in the private fixture, not this tree's gate inputs.
  const excludes = ["tooling", "node_modules"].map(directory => ["${configDir}", directory, "**", "*"].join("/"));
  writeFileSync(base, '{\n// configuration documentation\n"exclude":' + JSON.stringify(excludes) + ',"compilerOptions":{"noEmit":true,"target":"ESNext"}\n}\n');
  assert.deepEqual(await identity(), original, "comments, option order and an irrelevant inherited exclude do not change inputs");
  writeFileSync(base, JSON.stringify({ compilerOptions: { target: "ESNext", noEmit: true, strictNullChecks: true } }));
  assert.notEqual((await identity()).get(a), original.get(a), "an option changes identity even when the source graph stays the same");
  writeFileSync(base, JSON.stringify({ compilerOptions: { target: "ESNext", noEmit: true } }));
  writeFileSync(join(root, a, "case.ts"), "export function run() { return 2; }");
  assert.notEqual((await identity()).get(a), original.get(a), "case source contents remain an input");
  writeFileSync(join(root, a, "case.ts"), "export function run() { return 1; }");
  const own = join(root, b, "tsconfig.json");
  writeFileSync(own, JSON.stringify({ extends: "../../../tsconfig.fixtures.json", files: ["case.ts"] }));
  assert.deepEqual(await identity(), original, "an equivalent explicit config is not extra case data");
  writeFileSync(own, '{// own config comment\n"extends":"../../../tsconfig.fixtures.json","files":["case.ts"],"exclude":["unused/**/*"]}');
  assert.deepEqual(await identity(), original, "case-local config syntax is not source data either");
  writeFileSync(own, JSON.stringify({ extends: "../../../tsconfig.fixtures.json", files: ["case.ts", "../../common/input.ts"] }));
  assert.notEqual((await identity()).get(b), original.get(b), "root membership matters even when both source files were already loaded");
  writeFileSync(own, JSON.stringify({ extends: "../../../tsconfig.fixtures.json", files: ["case.ts"] }));
  // Oracle populations do not decide a compile result; ordinary local data still does.
  const domain = join(root, b, "case.domains.json");
  writeFileSync(domain, JSON.stringify({ version: 1, functions: { run: { n: { min: 0, max: 2 } } } }));
  assert.deepEqual(await identity(), original, "adding an oracle-only domain preserves compile identities");
  writeFileSync(domain, JSON.stringify({ version: 1, functions: { run: { n: { min: 0, max: 1 } } } }));
  assert.deepEqual(await identity(), original, "editing an oracle-only domain preserves compile identities");
  writeFileSync(join(root, "benchmarks/common/input.ts"), "export const input = 2;");
  const changedImport = await identity(); assert.equal(changedImport.get(a), original.get(a)); assert.notEqual(changedImport.get(b), original.get(b));
  writeFileSync(join(root, b, "data.txt"), "data two");
  assert.notEqual((await identity()).get(b), changedImport.get(b));
  writeFileSync(join(root, "tsconfig.fixtures.json"), JSON.stringify({ compilerOptions: { target: "ES2022", noEmit: true } }));
  assert.notEqual((await identity()).get(a), original.get(a));
  // An explicit compiler import changes the role: it is then source data.
  writeFileSync(join(root, "tsconfig.fixtures.json"), JSON.stringify({compilerOptions:{target:"ESNext",module:"ESNext",moduleResolution:"bundler",resolveJsonModule:true,noEmit:true}}));
  writeFileSync(join(root,b,"case.ts"), "import domain from './case.domains.json' with {type:'json'}; export function run(){return domain.version;}");
  const importedDomain=(await identity()).get(b);
  writeFileSync(domain, JSON.stringify({version:2}));
  assert.notEqual((await identity()).get(b),importedDomain,"an actually imported sidecar stays in the compiler's checked input graph");
});

test("compile cells run on their lanes at once, come back in their order, and stop at the first that throws", async () => {
  const { compileCells } = await import("./build-records.ts");
  type Outcome = import("./outcomes.ts").BenchmarkOutcome;
  const cells = ["a", "b", "c", "d"].map(name => ({ path: `benchmarks/cases/${name}`, backend: "c" as const }));
  const name = (cell: { path: string }) => cell.path.slice("benchmarks/cases/".length);
  const outcome: Record<string, Outcome> = { a: { kind: "pass" }, b: { kind: "timeout", stage: "compile" },
    c: { kind: "refused", diagnostic: "NTS1001 a shape" }, d: { kind: "pass" } };
  // a compiles until b has timed out and c has started on b's lane: a compile
  // past its bound is recorded beside one still running, and its lane goes on.
  const started: string[] = [], ended: string[] = [];
  const bEnded = Promise.withResolvers<void>(), cStarted = Promise.withResolvers<void>();
  let running = 0, most = 0;
  const outcomes = await compileCells(cells, 2, async (cell, lane) => {
    started.push(`${name(cell)} on lane ${lane}`); running += 1; most = Math.max(most, running);
    try {
      if (name(cell) === "a") await Promise.all([bEnded.promise, cStarted.promise]);
      if (name(cell) === "c") cStarted.resolve();
      return outcome[name(cell)]!;
    } finally { running -= 1; }
  }, { ended: cell => { ended.push(name(cell)); if (name(cell) === "b") bEnded.resolve(); } });
  assert.deepEqual(outcomes, cells.map(cell => outcome[name(cell)]), "the outcomes come back in the cells' order");
  assert.equal(most, 2, "never more compiles at once than lanes");
  assert.deepEqual(started.slice(0, 3), ["a on lane 0", "b on lane 1", "c on lane 1"]);
  assert.ok(ended.indexOf("b") < ended.indexOf("a"), `the timeout is recorded while a still compiles: ${ended.join(", ")}`);
  // A compile that throws stops the feed: the one running beside it ends, and nothing after them starts.
  const tried: string[] = [], bThrown = Promise.withResolvers<void>();
  await assert.rejects(compileCells(cells, 2, async cell => {
    tried.push(name(cell));
    if (name(cell) === "a") await bThrown.promise;
    if (name(cell) === "b") { bThrown.resolve(); throw new Error("benchmark NOT MEASURED: b"); }
    return outcome[name(cell)]!;
  }), /benchmark NOT MEASURED: b/);
  assert.deepEqual(tried, ["a", "b"], "no cell starts after the one that threw");
});

test("the records job reserves per lane: four lanes ask four times what one does, never past their caps", async t => {
  const { COMPILE_CAP_BYTES, recordsJob } = await import("./build-records.ts");
  const { jobSizing } = await import("../gate/memory-ledger.ts");
  const { historyFile, writeCostHistory } = await import("../gate/step-scheduling.ts");
  const env = { ...withoutHanded(fixtureEnvironment(t)), ...ownMemory(join(testScratch(t, "benchmark-record-sizing"), "memory")) };
  assert.equal(writeCostHistory(historyFile(env), { jobs: [{ key: "bench-compile-records", peak: 2 ** 30 }] }), undefined);
  const one = jobSizing(recordsJob(1, "one lane"), env), four = jobSizing(recordsJob(4, "four lanes"), env);
  assert.equal(one.basis, "measured");
  assert.equal(four.units, 4);
  assert.equal(four.bytes, 4 * one.bytes, "a lane's measured peak, times the lanes");
  assert.equal(writeCostHistory(historyFile(env), { jobs: [{ key: "bench-compile-records", peak: 7 * 2 ** 30 }] }), undefined);
  assert.equal(jobSizing(recordsJob(4, "four lanes"), env).bytes, 4 * COMPILE_CAP_BYTES, "never more than the lanes' own caps");
});
