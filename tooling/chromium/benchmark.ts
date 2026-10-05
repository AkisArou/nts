#!/usr/bin/env node
// Renderer-local architecture measurements; CDP stays outside timed loops.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { activeChromiumBuild } from "./profiles.ts";

interface Sample { path: string; round: number; length: number; iterations: number; elapsedNs: number; nsPerOperation: number; ntsAllocations?: number; ntsRetains?: number; ntsReleases?: number; ntsLiveObjects?: number }
interface EntrySample { scoped: boolean; round: number; length: number; operationsPerEntry: number; entries: number; elapsedNs: number; nsPerEntry: number; ntsAllocations: number }
interface Measurements { samples: Sample[]; entrySamples?: EntrySample[]; status: number; finalLength: number; payload: string; timing: string }
const root = resolve(import.meta.dirname, "../..");
const executable = resolve(process.argv[2] ?? "third_party/chromium/src/out/NtsBaseline/nts_shell");
const output = resolve(process.argv[3] ?? "target/chromium/binding-benchmark");
const backend = process.argv[4];
assert(backend === "c" || backend === "llvm", "Usage: benchmark.ts <nts_shell> <output> <c|llvm> [--allow-debug] [--cpu N] [--runs N]");
let runs = 3;
let cpu: number | undefined;
const allowDebug = process.argv.includes("--allow-debug");
for (let i = 5; i < process.argv.length; ++i) {
  const option = process.argv[i];
  if (option === "--allow-debug") continue;
  if (option === "--cpu") cpu = Number(process.argv[++i]);
  else if (option === "--runs") runs = Number(process.argv[++i]);
  else throw new Error(`Unknown option: ${option}`);
}
assert(Number.isSafeInteger(runs) && runs > 0);
assert(cpu === undefined || Number.isSafeInteger(cpu) && cpu >= 0);
const argsText = await readFile(resolve(dirname(executable), "args.gn"), "utf8");
const debugEngine = /is_debug\s*=\s*true/.test(argsText);
assert(allowDebug || !debugEngine, "Debug engine timings are diagnostic only; pass --allow-debug explicitly or use the optimized profile");
assert(argsText.includes(`nts_probe_backend = "${backend}"`));
const source = resolve(root, "third_party/chromium/src");
assert.equal(activeChromiumBuild(root), undefined, "Finish the active build before benchmarking");
assert.equal(execFileSync("git", ["-C", source, "diff", "HEAD", "--binary"], {encoding:"utf8"}), "");
const hash = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const evidenceDirectory = dirname(executable).endsWith("/NtsPerf") ? "target/chromium/perf" : "target/chromium";
const buildRecord = JSON.parse(await readFile(resolve(root, evidenceDirectory, "build-result.json"), "utf8")) as {
  state: string; target: string; gnArgsSha256: string; executableSha256: string; nativeManifestSha256: string;
};
assert.equal(buildRecord.state, "passed", "Require a completed successful build");
assert.equal(buildRecord.target, "nts_shell");
assert.equal(buildRecord.gnArgsSha256, hash(argsText), "Build arguments changed after building");
assert.equal(buildRecord.executableSha256, hash(await readFile(executable)), "Executable changed after building");
assert.equal(buildRecord.nativeManifestSha256, hash(await readFile(resolve(source, "nts/manifest.json"))), "Staging changed after building; rebuild first");
const fixturePath = resolve(root, "runtime/chromium/experiments/binding-benchmark/index.html");
const fixture = pathToFileURL(fixturePath).href;
await mkdir(output, {recursive:true});
const measurements: Array<{ run: number; native: Measurements; v8: Measurements; rendererStatus: string; loadBefore: string; loadAfter: string }> = [];

for (let run = 0; run < runs; ++run) {
  const profile = await mkdtemp(resolve(output, `profile-${run}-`));
  const args = ["--ozone-platform=x11", "--enable-logging=stderr", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, `--nts-probe-url=${fixture}`, fixture];
  const child = spawn("xvfb-run", ["-a", "-s", "-screen 0 1280x900x24", executable, ...args], {detached:true, stdio:["ignore","pipe","pipe"]});
  let log = "";
  let launchError: Error | undefined;
  let exited = false;
  child.on("error", error => { launchError = error; });
  child.on("exit", () => { exited = true; });
  child.stdout.on("data", chunk => { log += String(chunk); });
  child.stderr.on("data", chunk => {
    log += String(chunk);
    if (/FATAL:/.test(log)) {
      for (const entry of pending.values()) {clearTimeout(entry.timeout); entry.reject(new Error("Renderer check failed; see launch log"));}
      pending.clear();
    }
  });
  let socket: WebSocket | undefined;
  const pending = new Map<number, {accept: (value: unknown) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout>}>();
  async function until<T>(predicate: () => Promise<T> | T): Promise<NonNullable<T>> {
    const deadline = performance.now() + 60_000;
    do {
      if (launchError) throw launchError;
      if (exited) throw new Error("Benchmark browser exited");
      assert(!/FATAL:|NTS_.*unexpectedly ran/.test(log), "Renderer check failed; see launch log");
      const value = await predicate();
      if (value) return value as NonNullable<T>;
      await delay(100);
    } while (performance.now() < deadline);
    throw new Error(`Benchmark timed out; see ${output}/launch-${run}.log`);
  }
  try {
    const endpoint = await until(() => log.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1]);
    const origin = `http://${new URL(endpoint).host}`;
    const target = await until(async () => {
      const pages = await (await fetch(`${origin}/json/list`)).json() as Array<{url:string; webSocketDebuggerUrl:string}>;
      return pages.find(page => page.url === fixture);
    });
    const connection = new WebSocket(target.webSocketDebuggerUrl);
    socket = connection;
    await new Promise<void>((accept, reject) => {
      const timeout = setTimeout(() => reject(new Error("CDP connection timed out")), 10_000);
      connection.addEventListener("open", () => { clearTimeout(timeout); accept(); }, {once:true});
      connection.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("CDP connection failed")); }, {once:true});
    });
    let id = 0;
    connection.addEventListener("message", event => {
      const message = JSON.parse(String(event.data)) as {id?:number; error?:unknown; result:unknown};
      if (!message.id) return;
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id); clearTimeout(entry.timeout);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.accept(message.result);
    });
    function cdp<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      return new Promise((accept, reject) => {
        const next = ++id;
        const timeout = setTimeout(() => {pending.delete(next); reject(new Error(`CDP timeout: ${method}`));}, 60_000);
        pending.set(next, {accept: value => accept(value as T), reject, timeout});
        connection.send(JSON.stringify({id:next, method, params}));
      });
    }
    connection.addEventListener("close", () => {
      for (const entry of pending.values()) {clearTimeout(entry.timeout); entry.reject(new Error("Renderer connection closed; see launch log"));}
      pending.clear();
    });
    async function evaluate<T>(expression: string): Promise<T> {
      const result = await cdp<{exceptionDetails?:unknown; result:{value:T}}>("Runtime.evaluate", {expression, returnByValue:true});
      assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    }
    await until(() => evaluate<boolean>(`location.href === ${JSON.stringify(fixture)} && document.querySelector('#benchmark-result')?.getAttribute('data-state') === 'ready'`));
    const rendererPid = Number(log.match(/^\[(\d+):[^\]]+\][^\n]*NTS_PROBE attach/m)?.[1]);
    assert(Number.isSafeInteger(rendererPid) && rendererPid > 1);
    const command = (await readFile(`/proc/${rendererPid}/cmdline`, "utf8")).replaceAll("\0", " ");
    assert(command.startsWith(executable) && command.includes("--type=renderer"));
    if (cpu !== undefined) execFileSync("taskset", ["-pc", String(cpu), String(rendererPid)], {stdio:"pipe"});
    const rendererStatus = await readFile(`/proc/${rendererPid}/status`, "utf8");
    assert(/^Seccomp:\s+2$/m.test(rendererStatus));
    assert(/^NoNewPrivs:\s+1$/m.test(rendererStatus));
    assert((rendererStatus.match(/^NSpid:\s+(.+)$/m)?.[1].split(/\s+/).length ?? 0) > 1);
    assert.equal(await evaluate<number>("document.scripts.length"), 0);
    const loadBefore = (await readFile("/proc/loadavg", "utf8")).trim();
    const point = await evaluate<{x:number;y:number}>("(() => {const r=document.querySelector('#native-benchmark-run').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()");
    for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", {type,...point,button:"left",clickCount:1});
    await until(() => evaluate<boolean>("document.querySelector('#benchmark-result').getAttribute('data-state') === 'done'"));
    const native = JSON.parse(await evaluate<string>("document.querySelector('#benchmark-result').getAttribute('data-result')")) as Measurements;
    assert.equal(native.status, 0);
    assert.equal(native.finalLength, 4096);
    assert.equal(native.samples.length, 168);
    assert.equal(native.entrySamples?.length, 168);
    for (const sample of native.entrySamples ?? []) assert.equal(sample.ntsAllocations, 0);
    for (const sample of native.samples.filter(sample => sample.path.startsWith("compiled-"))) {
      if (sample.path.includes("prepared")) assert.equal(sample.ntsAllocations, 0, "prepared input must allocate no NTS objects per loop");
      else assert((sample.ntsAllocations ?? 0) >= sample.iterations, "fresh conversion must be counted");
    }
    // Separate V8 control on the same node. Its timer is inside the renderer;
    // native/V8 groups are ordered, so this is not a randomized ranking trial.
    const v8 = await evaluate<Measurements>(`(() => {
      const node=document.querySelector('#benchmark-text').firstChild;
      const samples=[];
      for(const length of [16,256,4096]) {
        const a='\u0100'+'x'.repeat(length-2)+'A', b='\u0100'+'x'.repeat(length-2)+'B';
        const loop=n=>{for(let i=0;i<n;i++) node.textContent=i%2?b:a;};
        loop(2048);
        let start=performance.now(); loop(2048); const calibration=Math.max(performance.now()-start,.001);
        const iterations=Math.max(32,Math.min(100000,Math.ceil((8*2048/calibration)/2)*2));
        for(let round=1;round<=7;round++) {
          start=performance.now(); loop(iterations); const elapsedNs=(performance.now()-start)*1e6;
          if(node.textContent!==b) throw Error('V8 output mismatch');
          samples.push({path:'v8-prepared',length,iterations,round,elapsedNs,nsPerOperation:elapsedNs/iterations});
        }
      }
      return {samples,status:0,finalLength:node.length,payload:'Alternating UTF-16 strings beginning with U+0100, ending A/B',timing:'Renderer performance.now around warmed loops; native and V8 groups ordered'};
    })()`);
    assert.equal(v8.finalLength, 4096);
    measurements.push({run,native,v8,rendererStatus,loadBefore,loadAfter:(await readFile("/proc/loadavg","utf8")).trim()});
    console.log(`Run ${run+1}/${runs}: ${native.samples.length} operation, ${native.entrySamples?.length} entry and ${v8.samples.length} V8 samples; sandbox active`);
  } finally {
    for (const entry of pending.values()) {clearTimeout(entry.timeout); entry.reject(new Error("Benchmark closed"));}
    pending.clear(); socket?.close();
    if (child.pid) {try {process.kill(-child.pid,"SIGTERM");} catch(error) {if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;}}
    await writeFile(resolve(output, `launch-${run}.log`), log);
  }
}
const all = measurements.flatMap(run => [...run.native.samples,...run.v8.samples]);
const percentile = (values:number[], fraction:number):number => values[Math.floor((values.length-1)*fraction)];
const summaries=[];
for (const length of [16,256,4096]) {
  for (const path of [...new Set(all.map(sample=>sample.path))]) {
    const samples=all.filter(sample=>sample.length===length&&sample.path===path);
    const values=samples.map(sample=>sample.nsPerOperation).sort((a,b)=>a-b);
    summaries.push({length,path,samples:values.length,medianNs:percentile(values,.5),q1Ns:percentile(values,.25),q3Ns:percentile(values,.75),
      minSampleMs:Math.min(...samples.map(sample=>sample.elapsedNs))/1e6,
      ntsAllocationsPerOperation:samples[0].ntsAllocations===undefined?undefined:samples[0].ntsAllocations/samples[0].iterations,
      ntsRetainsPerOperation:samples[0].ntsRetains===undefined?undefined:samples[0].ntsRetains/samples[0].iterations});
  }
}
const allEntries = measurements.flatMap(run => run.native.entrySamples ?? []);
const entrySummaries = [];
for (const length of [16,256,4096]) for (const operationsPerEntry of [0,2,8,32]) for (const scoped of [false,true]) {
  const samples = allEntries.filter(sample => sample.length === length && sample.operationsPerEntry === operationsPerEntry && sample.scoped === scoped);
  const values = samples.map(sample => sample.nsPerEntry).sort((a,b) => a-b);
  entrySummaries.push({length,operationsPerEntry,scoped,samples:values.length,medianNsPerEntry:percentile(values,.5),q1Ns:percentile(values,.25),q3Ns:percentile(values,.75),minSampleMs:Math.min(...samples.map(sample=>sample.elapsedNs))/1e6});
}
await writeFile(resolve(output,"result.json"),`${JSON.stringify({observedAt:new Date().toISOString(),backend,debugEngine,
  scope:debugEngine?"Diagnostic architecture comparison in debug Chromium; not a production performance claim":"Optimized component Chromium architecture comparison; not a final distribution or whole-application speedup",
  argsText,cpu,runs,buildRecord,executable,executableSha256:hash(await readFile(executable)),fixtureSha256:hash(await readFile(fixturePath)),
  chromiumRevision:execFileSync("git",["-C",source,"rev-parse","HEAD"],{encoding:"utf8"}).trim(),nativeManifestSha256:hash(await readFile(resolve(source,"nts/manifest.json"))),
  compilerCheck:JSON.parse(await readFile(resolve(root,"target/chromium/native-bootstrap/check-result.json"),"utf8")),
  cpuInfo:execFileSync("lscpu",[],{encoding:"utf8"}),measurements,summaries,entrySummaries},null,2)}\n`);
console.table(summaries.map(({length,path,medianNs,ntsAllocationsPerOperation})=>({length,path,ns:Math.round(medianNs),ntsAllocationsPerOperation})));
console.log(`Evidence: ${output}/result.json`);
