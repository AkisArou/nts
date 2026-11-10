import { FIXED_AMBIENT } from "./canonical-environment.ts";
import { spawnTest } from "./test-wait.ts";
import assert from "node:assert/strict";
import { COUNTER_SCOPE, COMPILE_WORK_PROFILE, COMPILE_WORK_SETTINGS } from "./compile-counter.ts";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { newTestScratch } from "./test-scratch.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

test("integrity executes every listing and counts only a kept prepared child", () => {
  const dir = newTestScratch("integrity-child-control");
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const compiler = join(bin, "nts");
    writeFileSync(compiler, `#!/usr/bin/env node
import {appendFileSync} from "node:fs";
const argv=process.argv.slice(2);
appendFileSync(process.env.CONTROL_COMMANDS,JSON.stringify({pid:process.pid,argv,ambient:Object.fromEntries(${JSON.stringify([...Object.keys(FIXED_AMBIENT), "RAYON_NUM_THREADS"])}.map(key=>[key,process.env[key]]))})+"\\n");
if(argv[0]==="hir") process.stdout.write("func control() -> void {\\n}\\n\\n1 function(s), nothing refused\\n");
`);
    chmodSync(compiler, 0o755);
    // Exercise the real collector without depending on perf permissions or
    // measuring host work. Only the selected command runs under the counter.
    const perf = join(bin, "perf");
    writeFileSync(perf, `#!/usr/bin/env node
import {appendFileSync,writeFileSync} from "node:fs";
import {spawn} from "node:child_process";
const argv=process.argv.slice(2),start=argv.indexOf("--");
if(start<0 || argv.includes("-p") || argv.includes("--no-inherit")) throw new Error("counter must launch with inheritance");
const child=spawn(argv[start+1],argv.slice(start+2),{stdio:"inherit"});
appendFileSync(process.env.CONTROL_COUNTERS,JSON.stringify({pid:child.pid,argv})+"\\n");
child.on("close",status=>{
  writeFileSync(argv[argv.indexOf("-o")+1],"123000 cpu_core/instructions/u\\n456 cpu_atom/instructions/u\\n0.010000000 seconds user\\n0.002000000 seconds sys\\n");
  process.exitCode=status??1;
});
`);
    chmodSync(perf, 0o755);
    for (const keep of [false, true]) {
      const arm = join(dir, keep ? "kept" : "unkept");
      mkdirSync(arm);
      const commands = join(arm, "commands.jsonl");
      const counters = join(arm, "counters.jsonl");
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, NTS_BIN: compiler, LC_ALL: "C", TZ: "Pacific/Kiritimati",
        NTS_INTEGRITY_JOBS: "1", NTS_GATE_COSTS_DIR: join(arm, "costs"), CONTROL_COMMANDS: commands, CONTROL_COUNTERS: counters };
      delete env.NTS_INTEGRITY_KEEP;
      delete env.NTS_GATE_TOKENS;
      if (keep) env.NTS_INTEGRITY_KEEP = join(arm, "listings");
      const result = spawnTest(process.execPath, ["tooling/conformance/integrity.ts", "runtime/node/integrity-control"],
        { cwd: ROOT, env, encoding: "utf8",});
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /1 of 1 project\(s\) measured, 1 function\(s\)/);
      const calls = readFileSync(commands, "utf8").trim().split("\n").map(JSON.parse);
      assert.deepEqual(calls.map(c => c.argv.slice(0, -1)), [["hir", "--prepared", ...(keep ? ["--checkers", "1"] : [])], ["hir"], ["layouts"], ["refusals"]]);
      for (const [index,call] of calls.entries()) assert.deepEqual(call.ambient, index===0 && keep ? {...FIXED_AMBIENT,RAYON_NUM_THREADS:"1"} : FIXED_AMBIENT);
      const counted = existsSync(counters) ? readFileSync(counters, "utf8").trim().split("\n").map(JSON.parse) : [];
      assert.deepEqual(counted.map(c => c.pid), keep ? [calls[0].pid] : []);
      if (keep) {
        const measured = JSON.parse(readFileSync(join(arm, "listings/runtime_node_integrity-control.json"), "utf8"));
        assert.equal(measured.status, 0);
        assert.equal(measured.cpu_s, 0.012);
        assert.equal(measured.counter_scope, COUNTER_SCOPE);
        assert.equal(measured.arm, "nogc");
        assert.equal(measured.work_profile, COMPILE_WORK_PROFILE);
        assert.deepEqual(measured.work_settings, COMPILE_WORK_SETTINGS);
        assert.equal(JSON.parse(readFileSync(join(arm, "listings/meta.json"), "utf8")).arm, "nogc");
        assert.ok(existsSync(measured.counter_file), "the raw counter file is retained");
        assert.equal(measured.instructions, 123456);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Each completed listing advances the fixture's clock by its assigned cost.
// One worker draws the heavy project first, so charging the light project's
// queue wait or summing its four listings changes its recorded cost.
test("integrity records a project's own listing time, not when it finished", () => {
  const dir = newTestScratch("integrity-cost-order");
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const clock = join(dir, "clock");
    writeFileSync(clock, "0");
    const preload = join(dir, "clock.mjs");
    writeFileSync(preload, `
import {readFileSync} from "node:fs";
Object.defineProperty(performance, "now", {
  value: () => Number(readFileSync(process.env.CONTROL_CLOCK, "utf8")),
});
`);
    const compiler = join(bin, "nts");
    writeFileSync(compiler, `#!/usr/bin/env node
import {readFileSync,renameSync,writeFileSync} from "node:fs";
const argv=process.argv.slice(2);
const clock=process.env.CONTROL_CLOCK;
const cost=argv[0]==="hir"&&argv[1]==="--prepared"&&argv.at(-1).endsWith("cost-heavy") ? 64 : 8;
writeFileSync(clock+".next",String(Number(readFileSync(clock,"utf8"))+cost));
renameSync(clock+".next",clock);
if(argv[0]==="hir") process.stdout.write("func control() -> void {\\n}\\n\\n1 function(s), nothing refused\\n");
`);
    chmodSync(compiler, 0o755);
    const costs = join(dir, "costs");
    mkdirSync(costs);
    const heavy = "runtime/node/cost-heavy", light = "runtime/node/cost-light";
    writeFileSync(join(costs, "integrity.json"), JSON.stringify({ [heavy]: 100, [light]: 1 }) + "\n");
    const env = { ...process.env, NTS_BIN: compiler, LC_ALL: "C", NTS_INTEGRITY_JOBS: "1", NTS_GATE_COSTS_DIR: costs, CONTROL_CLOCK: clock };
    delete env.NTS_INTEGRITY_KEEP;
    delete env.NTS_GATE_TOKENS;
    const result = spawnTest(process.execPath, ["--import", preload, "tooling/conformance/integrity.ts", heavy, light], { cwd: ROOT, env, encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /2 of 2 project\(s\) measured/);
    const recorded = JSON.parse(readFileSync(join(costs, "integrity.json"), "utf8"));
    assert.deepEqual(recorded, { [heavy]: 0.064, [light]: 0.008 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
