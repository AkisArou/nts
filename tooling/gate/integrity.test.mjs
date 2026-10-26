import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import {appendFileSync,existsSync} from "node:fs";
const argv=process.argv.slice(2);
appendFileSync(process.env.CONTROL_COMMANDS,JSON.stringify({pid:process.pid,argv})+"\\n");
if(argv[0]==="hir") process.stdout.write("func control() -> void {\\n}\\n\\n1 function(s), nothing refused\\n");
if(process.env.NTS_INTEGRITY_KEEP && argv[1]==="--prepared") {
  const deadline=Date.now()+5000;
  while(!existsSync(process.env.CONTROL_COUNTERS+"."+process.pid+".ready")) {
    if(Date.now()>=deadline)process.exit(4);
    await new Promise(resolve=>setTimeout(resolve,5));
  }
}
`);
    chmodSync(compiler, 0o755);
    // Exercise the real collector without depending on perf permissions or
    // measuring host work. Only the selected child may receive an attachment.
    const perf = join(bin, "perf");
    writeFileSync(perf, `#!/usr/bin/env node
import {appendFileSync,existsSync,writeFileSync} from "node:fs";
const argv=process.argv.slice(2),pid=Number(argv[argv.indexOf("-p")+1]);
appendFileSync(process.env.CONTROL_COUNTERS,JSON.stringify({pid,argv})+"\\n");
writeFileSync(process.env.CONTROL_COUNTERS+"."+pid+".ready","");
const timer=setInterval(()=>{
  if(existsSync("/proc/"+pid))return;
  clearInterval(timer);
  writeFileSync(argv[argv.indexOf("-o")+1],"123456,,instructions:u,1,100,,\\n");
},5);
`);
    chmodSync(perf, 0o755);
    for (const keep of [false, true]) {
      const arm = join(dir, keep ? "kept" : "unkept");
      mkdirSync(arm);
      const commands = join(arm, "commands.jsonl");
      const counters = join(arm, "counters.jsonl");
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, NTS_BIN: compiler,
        NTS_INTEGRITY_JOBS: "1", CONTROL_COMMANDS: commands, CONTROL_COUNTERS: counters };
      delete env.NTS_INTEGRITY_KEEP;
      delete env.NTS_GATE_TOKENS;
      if (keep) env.NTS_INTEGRITY_KEEP = join(arm, "listings");
      const result = spawnSync(process.execPath, ["tooling/conformance/integrity.ts", "runtime/node/integrity-control"],
        { cwd: ROOT, env, encoding: "utf8", timeout: 15_000 });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /1 of 1 project\(s\) measured, 1 function\(s\)/);
      const calls = readFileSync(commands, "utf8").trim().split("\n").map(JSON.parse);
      assert.deepEqual(calls.map(c => c.argv.slice(0, -1)), [["hir", "--prepared"], ["hir"], ["layouts"], ["refusals"]]);
      const attached = existsSync(counters) ? readFileSync(counters, "utf8").trim().split("\n").map(JSON.parse) : [];
      assert.deepEqual(attached.map(c => c.pid), keep ? [calls[0].pid] : []);
      if (keep) {
        const measured = JSON.parse(readFileSync(join(arm, "listings/runtime_node_integrity-control.json"), "utf8"));
        assert.equal(measured.status, 0);
        assert.equal(typeof measured.cpu_s, "number");
        assert.equal(measured.instructions, 123456);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
