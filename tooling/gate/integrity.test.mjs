import { FIXED_AMBIENT } from "./canonical-environment.ts";
import { spawnTest } from "./test-wait.ts";
import assert from "node:assert/strict";
import { COUNTER_SCOPE, COMPILE_WORK_PROFILE } from "./compile-counter.ts";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

test("integrity executes every listing and counts only a kept prepared child", () => {
  const base = join(homedir(), ".cache/nts-scratch");
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, "integrity-child-control-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const compiler = join(bin, "nts");
    writeFileSync(compiler, `#!/usr/bin/env node
import {appendFileSync} from "node:fs";
const argv=process.argv.slice(2);
appendFileSync(process.env.CONTROL_COMMANDS,JSON.stringify({pid:process.pid,argv,ambient:Object.fromEntries(["LANG", "LC_ALL", "TZ", "FORCE_COLOR", "TERM"].map(key=>[key,process.env[key]]))})+"\\n");
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
      assert.deepEqual(calls.map(c => c.argv.slice(0, -1)), [["hir", "--prepared", ...(keep ? ["--workers", "1"] : [])], ["hir"], ["layouts"], ["refusals"]]);
      for (const call of calls) assert.deepEqual(call.ambient, FIXED_AMBIENT);
      const counted = existsSync(counters) ? readFileSync(counters, "utf8").trim().split("\n").map(JSON.parse) : [];
      assert.deepEqual(counted.map(c => c.pid), keep ? [calls[0].pid] : []);
      if (keep) {
        const measured = JSON.parse(readFileSync(join(arm, "listings/runtime_node_integrity-control.json"), "utf8"));
        assert.equal(measured.status, 0);
        assert.equal(measured.cpu_s, 0.012);
        assert.equal(measured.counter_scope, COUNTER_SCOPE);
        assert.equal(measured.arm, "nogc");
        assert.equal(measured.work_profile, COMPILE_WORK_PROFILE);
        assert.equal(JSON.parse(readFileSync(join(arm, "listings/meta.json"), "utf8")).arm, "nogc");
        assert.ok(existsSync(measured.counter_file), "the raw counter file is retained");
        assert.equal(measured.instructions, 123456);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
