import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import { cpuList } from "../affinity.ts";
import { gateEnvironment } from "../canonical-environment.ts";
import { waitFor } from "../test-wait.ts";
import { GateScopes, type StepScope } from "./step-scope.ts";
import { newTestScratch } from "../test-scratch.ts";

test("nested census scopes belong to one step and another run remains live when it drains", async t => {
  const own = newTestScratch("nested-step-scope-run");
  type Exit = { status: number | null; signal: NodeJS.Signals | null; output: string };
  const owners: GateScopes[] = [];
  const entries: { scope: StepScope; ready: string; release: string; metadata: string; done: Promise<Exit>; stopped: () => string | undefined; drained: boolean }[] = [];
  try {
    for (const label of ["a", "b"]) {
      const owner = new GateScopes(process.env); owners.push(owner);
      const scope = owner.step({ max: 2 ** 31 }), ready = join(own, `${label}.json`), release = join(own, `${label}.release`), workerReady = join(own, `${label}.worker.json`), metadata = join(own, `${label}.owner.json`);
      const publish=JSON.stringify(new URL("../durable-record.ts",import.meta.url).href);
      const childSource = `import {readFileSync,watch,existsSync} from 'node:fs';import {durableRecord} from ${publish};
durableRecord(${JSON.stringify(workerReady)},{group:readFileSync('/proc/self/cgroup','utf8'),cpus:/^Cpus_allowed_list:\\s+(.+)$/m.exec(readFileSync('/proc/self/status','utf8'))[1]});
watch(${JSON.stringify(own)},()=>{if(existsSync(${JSON.stringify(release)}))process.exit(0);});`;
      const source = `import {readFileSync,existsSync,watch} from 'node:fs';import {spawn} from 'node:child_process';import {durableRecord} from ${publish};
import {MemoryRun} from ${JSON.stringify(new URL("../../census/worker-memory.ts", import.meta.url).href)};
const memory=new MemoryRun({budgetBytes:128*2**20,id:'nested-scope-control'});
durableRecord(${JSON.stringify(metadata)},{directory:memory.directory});
const until=path=>existsSync(path)?Promise.resolve():new Promise(resolve=>{const w=watch(${JSON.stringify(own)},()=>{if(existsSync(path)){w.close();resolve();}});if(existsSync(path)){w.close();resolve();}});
try{const worker=memory.worker(0,64*2**20),bound=worker.scope(process.execPath,['--input-type=module','-e',${JSON.stringify(childSource)}]);
const child=spawn('systemd-run',bound.argv,{env:bound.env,stdio:['ignore','ignore','inherit']});
const ended=new Promise((_,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>reject(new Error('nested worker ended before ready: '+code+' '+signal)));});
await Promise.race([until(${JSON.stringify(workerReady)}),ended]);
durableRecord(${JSON.stringify(ready)},{census:memory.group,worker:JSON.parse(readFileSync(${JSON.stringify(workerReady)},'utf8')),lang:process.env.LANG,limits:readFileSync('/proc/self/limits','utf8')});
await until(${JSON.stringify(release)});
}finally{memory.close();}`;
      const launch = scope.command(process.execPath, ["--input-type=module", "-e", source]);
      const env = gateEnvironment(process.env, { run: join(own, `run-${label}`), owned: { NTS_TOOLING_SLICE: scope.slice } }).env;
      const child = spawn(launch.command, launch.args, { env, stdio: ["ignore", "pipe", "pipe"] });
      let output = "", exit: Exit | undefined;
      child.stdout.on("data", part => { output += part; }); child.stderr.on("data", part => { output += part; });
      const done = new Promise<Exit>((resolve, reject) => { child.once("error", reject); child.once("close", (status, signal) => { exit = { status, signal, output }; resolve(exit); }); });
      entries.push({ scope, ready, release, metadata, done, stopped: () => exit ? JSON.stringify(exit) : undefined, drained: false });
    }
    for (const entry of entries) await waitFor("nested census worker ready", () => existsSync(entry.ready), { stopped: entry.stopped });
    const [first, second] = entries;
    assert.ok(first && second);
    assert.notEqual(first.scope.slice, second.scope.slice);
    for (const entry of entries) {
      const actual = JSON.parse(readFileSync(entry.ready, "utf8")) as { census: string; worker: { group: string; cpus: string }; lang: string; limits: string };
      assert.ok(actual.census.startsWith(`${entry.scope.group}/`));
      assert.ok(actual.worker.group.trim().startsWith(`0::${actual.census}/`));
      assert.ok(!cpuList(actual.worker.cpus).includes(4) && !cpuList(actual.worker.cpus).includes(5));
      assert.equal(actual.lang, "C.UTF-8");
      assert.match(actual.limits, /^Max core file size\s+0\s+0\s+bytes/m);
    }
    first.scope.kill(); await first.done;
    const proof = await first.scope.drain(); first.drained = true;
    assert.equal(proof.populated, 0);
    assert.match(readFileSync(`/sys/fs/cgroup${second.scope.group}/cgroup.events`, "utf8"), /^populated 1$/m, "one run cannot drain another run's scope");
    assert.equal(second.stopped(), undefined);
    t.diagnostic(JSON.stringify({ first: proof, secondLiveGroup: second.scope.group }));
    writeFileSync(second.release, "finish normally");
    const ended = await second.done; assert.equal(ended.status, 0, ended.output); assert.equal(ended.signal, null);
    assert.equal((await second.scope.drain()).populated, 0); second.drained = true;
  } finally {
    for (const entry of entries) if (!entry.drained) { entry.scope.kill(); await entry.done; await entry.scope.drain(); }
    for (const owner of owners) owner.close();
    for (const entry of entries) if (existsSync(entry.metadata)) {
      const { directory } = JSON.parse(readFileSync(entry.metadata, "utf8")) as { directory: string };
      assert.equal(dirname(directory), join(homedir(), ".cache/nts/worker-memory"));
      assert.ok(basename(directory).startsWith(`${entry.scope.slice.slice(0, -6)}-`));
      rmSync(directory, { recursive: true, force: true });
    }
    rmSync(own, { recursive: true, force: true });
  }
});
