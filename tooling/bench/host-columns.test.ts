import {scriptedCommand,commandSample} from '../gate/command-observations-fixture.ts';
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { parse } from "acorn";
import { typedTimer } from "./typed-timer.ts";
import { parseMeasurement, buildCommand, buildFailure, coldStartup, countedCell, launchCpu, nodeOracle, ntsIdentity, projectedTimer } from "./host-columns.ts";
import type { NetCount } from "./count-driver.ts";
import { chmodSync, rmSync, utimesSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { gitArguments } from "../gate/git-arguments/main.ts";
import { sourceDigest } from "./source-identity.ts";
import { buildLauncher } from "./launcher.ts";
import { LAUNCH_PROTOCOL } from "./launch-cell.ts";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import {type activeCommand, COMPILE_CPU_BOUND_SECONDS} from "../gate/active-command.ts";
import {testScratch} from "../gate/test-scratch.ts";
function receipt() {
  return {
    command: ["probe"],
    cwd: "/",
    startedAt: "2026-10-29T00:00:00Z",
    finishedAt: "2026-10-29T00:00:01Z",
    status: 0 as number | null,
    signal: null as string | null,
    stdout: "123.5 4000000000000000\n",
    stderr: "",
    wallNanoseconds: 1e9,
    cpu5: null,
  };
}
test("typed timing projection erases to the one canonical loop", () => {
  const source = readFileSync(
    new URL("../../benchmarks/common/bench.mjs", import.meta.url),
    "utf8",
  );
  const projected = typedTimer(source);
  const syntax = (s: string) =>
    JSON.stringify(
      parse(stripTypeScriptTypes(s), { ecmaVersion: "latest", sourceType: "module" }),
      (key, value) =>
        key === "start" || key === "end"
          ? undefined
          : typeof value === "bigint"
            ? String(value) + "n"
            : value,
    );
  assert.equal(syntax(projected), syntax(source));
  assert.throws(
    () =>
      typedTimer(source.replace("export function measure(run)", "export function renamed(run)")),
    /canonical timer changed/,
  );
});
test("host observations distinguish checksum, CPU budget, abort and hang", () => {
  const r = receipt();
  assert.deepEqual(parseMeasurement(r, "4000000000000000"), {
    ns: 123.5,
    checksum: "4000000000000000",
  });
  for (const [changed, status] of [
    [{ stdout: "123.5 0000000000000000" }, "INVALID"],
    [{ signal: "SIGXCPU", status: null }, "OVER_BUDGET"],
    [{ status: 124 }, "TIMED_OUT"],
    [{ signal: "SIGSEGV", status: null }, "ABORTED"],
    [{ stdout: "" }, "INVALID"],
  ] as const) {
    const observed = parseMeasurement({ ...r, ...changed }, "4000000000000000");
    assert.ok("status" in observed);
    assert.equal(observed.status, status);
    assert.equal(observed.nanoseconds, null);
  }
});

test("comparator builds share the compile bound and record a spinning child without blocking the next build", async t => {
  const root=testScratch(t,"comparator-build-bound");
  const supervise:typeof activeCommand=async(command,args,options)=>{
    assert.equal(options.eachProcessCpuSeconds,COMPILE_CPU_BOUND_SECONDS);
    return args.includes('--next')?scriptedCommand(command,options,[],{stdout:'next built'}):
      scriptedCommand(command,options,[commandSample(300,{cpu:60_000,own:0,busy:true,processOwn:{pid:71,cpu:60_000}})]);
  };
  const stopped=await buildCommand('/supplied-driver',[],root,{},supervise);
  assert.match(stopped.timeout??"",/process \d+ own CPU reached/);
  const cell=buildFailure(stopped);
  assert.equal(cell.status,"TIMED_OUT");
  assert.match(cell.reason??"",/^timed out building:/);
  assert.equal(cell.nanoseconds,null);
  const next=await buildCommand('/supplied-driver',['--next'],root,{},supervise);
  assert.equal(next.status,0,next.stderr);
  assert.equal(next.stdout,"next built");
});

test("an unmeasured comparator build keeps its hold instead of yielding a failure cell", async t => {
  const root=testScratch(t,"comparator-build-hold");
  const supervise:typeof activeCommand=async(command,_args,options)=>scriptedCommand(command,{...options,idleMs:200},[commandSample(200)]);
  await assert.rejects(()=>buildCommand("python3",["-c","import time; time.sleep(60)"],root,
    {},supervise),/build not measured:.*hung/);
});

test("the cold-startup arm is one launch of the launch timer, under its named protocol", async t => {
  const dir = testScratch(t, "cold-startup");
  const script = join(dir, "cold.sh");
  writeFileSync(script, '[ "$NTS_BENCH_STARTUP" = 1 ] || exit 7\necho "123.5 4000000000000000"\n');
  const cold = { launcher: buildLauncher(join(dir, "bin"), String(launchCpu().cpu)), directory: join(dir, "cold"), cwd: dir };
  const observed = await coldStartup(cold, "/bin/sh", [script], "4000000000000000", "case-node") as Record<string, unknown>;
  assert.equal(observed.protocol, LAUNCH_PROTOCOL);
  assert.equal(observed.status, "OK");
  assert.ok(typeof observed.wallNanoseconds === "number" && observed.wallNanoseconds > 0);
  assert.deepEqual(observed.argv, ["/bin/sh", script]);
  assert.equal((await coldStartup(cold, "/bin/sh", [script], "5000000000000000", "case-bun") as Record<string, unknown>).status, "INVALID");
  writeFileSync(script, "exit 1\n");
  assert.equal((await coldStartup(cold, "/bin/sh", [script], "4000000000000000", "case-aot") as Record<string, unknown>).status, "ABORTED");
});

test("launch rows refuse an nts that is missing or built from other sources than the measured commit's, whatever its mtime", t => {
  const dir = testScratch(t, "nts-identity"), root = fileURLToPath(new URL("../..", import.meta.url));
  const git = (...args: string[]) => execFileSync("git", gitArguments(args), { cwd: root, encoding: "utf8" }).trim();
  const head = git("rev-parse", "HEAD"), changed = git("log", "-1", "--format=%H", head, "--", "compiler");
  const nts = join(dir, "nts");
  assert.throws(() => ntsIdentity(nts, root, head), /does not exist/);
  const built = (source: string, depInfo: string | null = `${nts}: ${root}Cargo.lock ${root}compiler/core/src/lib.rs`) => {
    writeFileSync(nts, `#!/bin/sh\necho "nts 0.0.0"\n${source}\n`);
    chmodSync(nts, 0o755);
    utimesSync(nts, new Date(), new Date()); // a fresh copy, as the nightly's: the mtime decides nothing
    if (depInfo === null) rmSync(nts + ".d", { force: true });
    else writeFileSync(nts + ".d", depInfo + "\n");
  };
  built(`echo "source digest ${sourceDigest(root, `${changed}~1`, "nts")}"`);
  assert.throws(() => ntsIdentity(nts, root, head), /was not built from .*'s sources/);
  built("");
  assert.throws(() => ntsIdentity(nts, root, head), /names no source digest/);
  const digest = sourceDigest(root, head, "nts");
  built(`echo "source digest ${digest}"`, null);
  assert.throws(() => ntsIdentity(nts, root, head), /nts\.d is missing/);
  built(`echo "source digest ${digest}"`, `${nts}: ${root}Cargo.lock ${root}docs/README.md`);
  assert.throws(() => ntsIdentity(nts, root, head), /reads files outside its source roots .*docs\/README\.md/);
  built(`echo "source digest ${digest}"`);
  assert.equal(ntsIdentity(nts, root, head).sourceDigest, digest);
});

/** Brackets as count-driver.ts's netCount returns them, every one printing `checksum`. */
function brackets(checksum: string, calibrated: boolean): NetCount {
  const value = (n: number, warmup: number) => ({ checksum, n, warmup, nsPerOp: n ? 2 : 0 });
  const arms = { "probe-empty": { instructions: 1_284_187, value: value(0, 0) }, probe: { instructions: calibrated ? 2_284_187 : 1_065_373, value: value(1, 0) } };
  return calibrated
    ? { calibrated, instrument: "instruction-calibrated-empty-subtracted-v1", instructions: 100_000_000, counted: value(100, 100),
        calibration: { reps: 100, warmup: 100, target_instructions: 100_000_000, one_operation_instructions: 1_000_000 }, brackets: arms }
    : { calibrated, instrument: "instruction-calibrated-empty-subtracted-v1", reason: "probe-empty 1284187 >= probe 1065373 instructions", brackets: arms };
}
test("a counted host cell is held to the oracle, and an uncalibrated count is informational, never a checksum", () => {
  const ok = countedCell(brackets("4008000000000000", true), "4008000000000000", null);
  assert.equal(ok.status, "OK");
  assert.equal(ok.instructions, 100_000_000);
  assert.equal(ok.counted_reps, 100);
  const uncalibrated = countedCell(brackets("4008000000000000", false), "4008000000000000", null);
  assert.equal(uncalibrated.status, "INVALID");
  assert.equal(uncalibrated.reason, "count uncalibrated: probe-empty 1284187 >= probe 1065373 instructions");
  assert.equal(uncalibrated.instructions, undefined);
  assert.equal((uncalibrated.details as { calibration: string }).calibration, "uncalibrated");
  // A count, calibrated or not, whose brackets disagree with the oracle is a disagreement.
  for (const calibrated of [true, false])
    assert.equal(countedCell(brackets("4014000000000000", calibrated), "4008000000000000", null).reason,
      "Checksum disagreement; no count accepted");
});
test("the node oracle is the uncounted first call of the same entry and input", async t => {
  const dir = testScratch(t, "node-oracle");
  const timer = join(dir, "timer.ts"), entry = join(dir, "entry.ts");
  writeFileSync(timer, projectedTimer(readFileSync(new URL("../../benchmarks/common/bench.mjs", import.meta.url), "utf8")));
  // Each call answers a larger number, so a warmed call is told from the first.
  writeFileSync(entry, `import { measure } from ${JSON.stringify(timer)};\nlet calls = 0;\nconst input = Number(process.argv[2]);\nmeasure(() => input + calls++);\n`);
  const bits = (value: number) => { const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value); return view.getBigUint64(0).toString(16).padStart(16, "0"); };
  const three = await nodeOracle([entry, "3"], dir);
  assert.equal(three.status, "OK");
  assert.equal(three.checksum, bits(3));
  // The counted brackets print the first call's checksum on the same input
  // (bench.mjs `measure`): a different size or a warmed call is a mismatch.
  assert.equal(countedCell(brackets(bits(3), true), three.checksum!, null).status, "OK");
  for (const other of [bits(5), bits(4)])
    assert.equal(countedCell(brackets(other, true), three.checksum!, null).status, "INVALID");
  assert.equal((await nodeOracle([entry, "5"], dir)).checksum, bits(5));
  writeFileSync(entry, "process.exit(3);\n");
  const crashed = await nodeOracle([entry, "3"], dir);
  assert.equal(crashed.status, "ABORTED");
  assert.equal(crashed.checksum, null);
});
