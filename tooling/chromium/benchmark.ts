#!/usr/bin/env node
// Renderer-local architecture measurements; CDP stays outside timed loops.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { activeChromiumBuild } from "./profiles.ts";

interface Sample { payload: string; path: string; round: number; length: number; iterations: number; elapsedNs: number; nsPerOperation: number; ntsAllocations?: number; ntsRetains?: number; ntsReleases?: number; ntsLiveObjects?: number }
interface EntrySample { entry: string; round: number; length: number; operationsPerEntry: number; entries: number; elapsedNs: number; nsPerEntry: number; ntsAllocations: number }
interface Measurements { samples: Sample[]; entrySamples?: EntrySample[]; status: number; finalLength: number; payload: string; timing: string; exactUnits?: number[] }
// The rows workload (--workload rows): one sample per batch of an operation.
interface RowsSample { case: string; round: number; batch: number; elapsedNs: number; nsPerOperation: number; rows: number; ntsAllocations?: number; ntsLiveObjects?: number; idleCollectNs?: number; layoutNs?: number }
// The kernels workload (--workload kernels): native-typescript's binding
// kernels, one sample per task, in blink-intrinsic, compiled and v8 lanes.
interface KernelsSample { kernel: string; shape: string; lane: string; round: number; iterations: number; nsPerOperation: number; ntsAllocations?: number }
interface KernelsMeasurements { samples: KernelsSample[]; status: number; liveLeases?: number; timing: string }
interface RowsMeasurements { samples: RowsSample[]; status: number; finalRows: number; liveLeases?: number; leasesAfterDestroy?: number; dom?: string; structure?: string; timing: string }
type Mode = "native" | "v8";
interface LaunchResult { result: Measurements; executable: string; fixture: string; args: string[]; rendererPid: number; rendererStatus: string; loadBefore: string; loadAfter: string }
const root = resolve(import.meta.dirname, "../..");
const executable = resolve(process.argv[2] ?? "third_party/chromium/src/out/NtsBaseline/nts_shell");
const output = resolve(process.argv[3] ?? "target/chromium/binding-benchmark");
const backend = process.argv[4];
assert(backend === "c" || backend === "llvm", "Usage: benchmark.ts <nts_shell> <output> <c|llvm> [--allow-debug] [--cpu N] [--runs N] [--workload binding|rows] [--collection idle|checkpoint] [--trace-gc]");
let runs = 6;
let cpu: number | undefined;
let workload: "binding" | "rows" | "kernels" = "binding";
let collection: "checkpoint" | "idle" = "idle";
// --trace-gc: V8's GC trace in both launches. Oilpan collects inside V8's
// unified heap, so its mark-compacts are in the same lines.
let traceGc = false;
// --trace: a Chromium trace of each launch (timeline, GC), streamed over CDP
// to trace-<run>-<mode>.json beside the launch logs. Diagnostic: tracing
// costs time, so its timings are not results.
let trace = false;
// --diagnostic-js-flags F: V8 flags given to both engines, to test a
// mechanism (e.g. --no-incremental-marking). Recorded in the result; a run
// with them is a diagnosis, never a performance result.
let diagnosticJsFlags: string | undefined;
const allowDebug = process.argv.includes("--allow-debug");
for (let i = 5; i < process.argv.length; ++i) {
  const option = process.argv[i];
  if (option === "--allow-debug") continue;
  if (option === "--cpu") cpu = Number(process.argv[++i]);
  else if (option === "--runs") runs = Number(process.argv[++i]);
  else if (option === "--trace-gc") traceGc = true;
  else if (option === "--trace") trace = true;
  else if (option === "--diagnostic-js-flags") diagnosticJsFlags = process.argv[++i];
  else if (option === "--collection") {
    const value = process.argv[++i];
    assert(value === "checkpoint" || value === "idle", "--collection must be checkpoint or idle");
    collection = value;
  }
  else if (option === "--workload") {
    const value = process.argv[++i];
    assert(value === "binding" || value === "rows" || value === "kernels", "--workload must be binding, rows or kernels");
    workload = value;
  }
  else throw new Error(`Unknown option: ${option}`);
}
// Binding runs rotate three payload orders; rows only alternates launch order.
assert(Number.isSafeInteger(runs) && runs > 0 && runs % (workload === "binding" ? 6 : 2) === 0,
  workload === "binding" ? "Use a multiple of six runs to balance three payload orders and both launch orders" : "Use an even number of runs to balance launch order");
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
  state: string; target: string; gnArgsSha256: string; executableSha256: string; nativeManifestSha256: string; v8ControlExecutableSha256: string;
};
assert.equal(buildRecord.state, "passed", "Require a completed successful build");
assert.equal(buildRecord.target, "nts_shell");
assert.equal(buildRecord.gnArgsSha256, hash(argsText), "Build arguments changed after building");
assert.equal(buildRecord.executableSha256, hash(await readFile(executable)), "Executable changed after building");
assert.equal(buildRecord.nativeManifestSha256, hash(await readFile(resolve(source, "nts/manifest.json"))), "Staging changed after building; rebuild first");
const fixturePath = resolve(root, `runtime/chromium/experiments/${workload}-benchmark/index.html`);
const v8Executable = resolve(dirname(executable), "content_shell");
const v8FixturePath = resolve(root, `runtime/chromium/experiments/${workload}-benchmark-v8/index.html`);
assert.equal(buildRecord.v8ControlExecutableSha256, hash(await readFile(v8Executable)), "Build the unmodified V8 control with the same profile");
await mkdir(output, {recursive:true});
const measurements: Array<{ run: number; order: Mode[]; native: Measurements; v8: Measurements; launches: Record<Mode, LaunchResult> }> = [];

async function rendererDescendants(parentPid: number, engine: string): Promise<number[]> {
  const candidates = await Promise.all((await readdir("/proc")).filter(name => /^\d+$/.test(name)).map(async name => {
    try {
      const command = (await readFile(`/proc/${name}/cmdline`, "utf8")).replaceAll("\0", " ");
      if (!command.startsWith(`${engine} `) || !command.includes("--type=renderer")) return undefined;
      let parent = Number((await readFile(`/proc/${name}/status`, "utf8")).match(/^PPid:\s+(\d+)/m)?.[1]);
      const seen = new Set<number>();
      while (parent > 1 && parent !== parentPid && !seen.has(parent)) {
        seen.add(parent);
        parent = Number((await readFile(`/proc/${parent}/status`, "utf8")).match(/^PPid:\s+(\d+)/m)?.[1]);
      }
      return parent === parentPid ? Number(name) : undefined;
    } catch (error) {
      if (error instanceof Error && "code" in error && ["ENOENT","ESRCH","EACCES"].includes(String(error.code))) return undefined;
      throw error;
    }
  }));
  return candidates.filter((pid): pid is number => pid !== undefined);
}

async function measure(run: number, mode: Mode): Promise<LaunchResult> {
  const profile = await mkdtemp(resolve(output, `profile-${run}-${mode}-`));
  const engine = mode === "native" ? executable : v8Executable;
  const url = pathToFileURL(mode === "native" ? fixturePath : v8FixturePath);
  url.searchParams.set("order", String(run % 3));
  const fixture = url.href;
  // Suppress only spare-process prewarming, equally for both arms, to make
  // the measured tab's PID unambiguous. V8/JIT/Web-platform flags stay normal.
  const args = ["--ozone-platform=x11", "--disable-features=SpareRendererForSitePerProcess", "--enable-logging=stderr", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`];
  if (mode === "native") args.push(`--nts-probe-url=${fixture}`, `--nts-benchmark-order=${run % 3}`);
  if (mode === "native" && workload === "rows") args.push(`--nts-collection=${collection}`);
  const jsFlags = [...(traceGc ? ["--trace-gc"] : []), ...(diagnosticJsFlags ? [diagnosticJsFlags] : [])];
  if (jsFlags.length) args.push(`--js-flags=${jsFlags.join(" ")}`);
  args.push(fixture);
  const child = spawn("xvfb-run", ["-a", "-s", "-screen 0 1280x900x24", engine, ...args], {detached:true, stdio:["ignore","pipe","pipe"]});
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
    throw new Error(`Benchmark timed out; see ${output}/launch-${run}-${mode}.log`);
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
    let traceStream: string | undefined;
    connection.addEventListener("message", event => {
      const message = JSON.parse(String(event.data)) as {id?:number; method?:string; params?:{stream?:string}; error?:unknown; result:unknown};
      if (message.method === "Tracing.tracingComplete") traceStream = message.params?.stream ?? "";
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
    assert(child.pid);
    const renderers = await rendererDescendants(child.pid, engine);
    assert.equal(renderers.length, 1, "Require an unambiguous measured renderer; do not guess among spare processes");
    const rendererPid = renderers[0];
    if (mode === "native") assert.equal(rendererPid, Number(log.match(/^\[(\d+):[^\]]+\][^\n]*NTS_PROBE attach/m)?.[1]));
    assert(Number.isSafeInteger(rendererPid) && rendererPid > 1);
    const command = (await readFile(`/proc/${rendererPid}/cmdline`, "utf8")).replaceAll("\0", " ");
    assert(command.startsWith(engine) && command.includes("--type=renderer"));
    if (cpu !== undefined) execFileSync("taskset", ["-pc", String(cpu), String(rendererPid)], {stdio:"pipe"});
    const rendererStatus = await readFile(`/proc/${rendererPid}/status`, "utf8");
    assert(/^Seccomp:\s+2$/m.test(rendererStatus));
    assert(/^NoNewPrivs:\s+1$/m.test(rendererStatus));
    assert((rendererStatus.match(/^NSpid:\s+(.+)$/m)?.[1].split(/\s+/).length ?? 0) > 1);
    assert.equal(await evaluate<number>("document.scripts.length"), mode === "native" ? 0 : 1);
    const loadBefore = (await readFile("/proc/loadavg", "utf8")).trim();
    const selector = `#${mode}-${workload === "binding" ? "benchmark" : workload}-run`;
    const point = await evaluate<{x:number;y:number}>(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    if (trace) await cdp("Tracing.start", {transferMode:"ReturnAsStream", traceConfig:{recordMode:"recordAsMuchAsPossible",
      includedCategories:["devtools.timeline","disabled-by-default-devtools.timeline","blink.user_timing","v8.gc","disabled-by-default-v8.gc","blink_gc","cppgc"]}});
    for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", {type,...point,button:"left",clickCount:1});
    await until(() => evaluate<boolean>("document.querySelector('#benchmark-result').getAttribute('data-state') === 'done'"));
    if (trace) {
      await cdp("Tracing.end");
      const stream = await until(() => traceStream);
      const chunks: string[] = [];
      for (;;) {
        const chunk = await cdp<{data:string; base64Encoded?:boolean; eof:boolean}>("IO.read", {handle:stream, size:1 << 20});
        chunks.push(chunk.base64Encoded ? Buffer.from(chunk.data, "base64").toString("utf8") : chunk.data);
        if (chunk.eof) break;
      }
      await cdp("IO.close", {handle:stream});
      await writeFile(resolve(output, `trace-${run}-${mode}.json`), chunks.join(""));
    }
    const result = JSON.parse(await evaluate<string>("document.querySelector('#benchmark-result').getAttribute('data-result')")) as Measurements;
    assert.equal(result.status, 0);
    if (workload === "kernels") {
      const kernels = result as unknown as KernelsMeasurements;
      // Two kernels x two shapes x twenty samples, per lane: two lanes native.
      assert.equal(kernels.samples.length, mode === "native" ? 160 : 80);
      if (mode === "native") {
        assert.equal(kernels.liveLeases, 0, "every kernel lease must be released");
        for (const sample of kernels.samples.filter(sample => sample.lane === "compiled"))
          assert.equal(sample.ntsAllocations, 0, `${sample.kernel} ${sample.shape} allocated NTS objects`);
      }
      console.log(`Run ${run+1}/${runs}, ${mode}: ${kernels.samples.length} kernel samples; normal JIT, sandbox active`);
      return {result,executable:engine,fixture,args,rendererPid,rendererStatus,loadBefore,loadAfter:(await readFile("/proc/loadavg","utf8")).trim()};
    }
    if (workload === "rows") {
      const rows = result as unknown as RowsMeasurements;
      // Twelve cases of 15 measured rounds and two of six, on both engines.
      assert.equal(rows.samples.length, 192);
      assert.equal(rows.finalRows, 999);
      // tbody + template + (tr, label text) per row: every other lease released.
      if (mode === "native") assert.equal(rows.liveLeases, 2 + 2 * rows.finalRows, "native handles leaked");
      if (mode === "native") assert.equal(rows.leasesAfterDestroy, 0, "destroying the app and releasing the query must leave no lease");
      rows.dom = await evaluate<string>("[...document.querySelector('#tbody').rows].map(r => r.className + '|' + r.textContent).join('\\n')");
      // The whole subtree, not only what the rows say: markup, and every node
      // by type, empty text nodes included -- what layout actually walks.
      rows.structure = await evaluate<string>("(() => { const t = document.querySelector('#tbody'); const counts = {}; const w = document.createTreeWalker(t); for (let n = w.currentNode; n; n = w.nextNode()) { const k = n.nodeType === 3 ? (n.data.length ? 'text' : 'empty-text') : n.nodeName; counts[k] = (counts[k] || 0) + 1; } return JSON.stringify({counts, markup: t.outerHTML}); })()");
      const shape = await evaluate<string>("(() => { const t = document.querySelector('#tbody'); const c = t.firstElementChild; return JSON.stringify({children: t.children.length, rows: t.rows.length, first: c && {tag: c.tagName, ns: c.namespaceURI, kind: Object.prototype.toString.call(c)}}); })()");
      assert.equal(rows.dom.split("\n").length, rows.finalRows, `Inspect actual Blink output, not only the benchmark's self-check: ${shape}`);
      console.log(`Run ${run+1}/${runs}, ${mode}: ${rows.samples.length} rows samples; normal JIT, sandbox active`);
      return {result,executable:engine,fixture,args,rendererPid,rendererStatus,loadBefore,loadAfter:(await readFile("/proc/loadavg","utf8")).trim()};
    }
    const finalLength = [16,256,4096][(run % 3 + 2) % 3];
    assert.equal(result.finalLength, finalLength);
    // Two payload families x three lengths x rows x seven rounds; the entry
    // matrix is four operation counts (even, so each ends on B) x three entry kinds x seven rounds.
    assert.equal(result.samples.length, mode === "native" ? 294 : 84);
    if (mode === "native") assert.equal(result.entrySamples?.length, 84);
    for (const sample of result.entrySamples ?? []) assert.equal(sample.ntsAllocations, 0);
    for (const sample of result.samples.filter(sample => sample.path.startsWith("compiled-"))) {
      if (sample.path.includes("prepared")) assert.equal(sample.ntsAllocations, 0, "prepared input must allocate no NTS objects per loop");
      else if (sample.path.includes("fresh"))
        assert((sample.ntsAllocations ?? 0) >= sample.iterations, "per-mutation strings must be counted");
      else if (sample.path.endsWith("-string")) assert.equal(sample.ntsAllocations, 0, "a string view must allocate nothing");
    }
    const exactUnits = await evaluate<number[]>("(() => {const s=document.querySelector('#benchmark-text').textContent; return Array.from({length:s.length},(_,i)=>s.charCodeAt(i));})()");
    assert.deepEqual(exactUnits, [256,...Array<number>(finalLength-2).fill(120),66], "Inspect actual Blink output, not only the benchmark's self-check");
    if (result.exactUnits) assert.deepEqual(result.exactUnits, exactUnits);
    result.exactUnits = exactUnits;
    console.log(`Run ${run+1}/${runs}, ${mode}: ${result.samples.length} operation and ${result.entrySamples?.length ?? 0} entry samples; normal JIT, sandbox active`);
    return {result,executable:engine,fixture,args,rendererPid,rendererStatus,loadBefore,loadAfter:(await readFile("/proc/loadavg","utf8")).trim()};
  } finally {
    for (const entry of pending.values()) {clearTimeout(entry.timeout); entry.reject(new Error("Benchmark closed"));}
    pending.clear(); socket?.close();
    if (child.pid) {try {process.kill(-child.pid,"SIGTERM");} catch(error) {if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;}}
    await writeFile(resolve(output, `launch-${run}-${mode}.log`), log);
  }
}
for (let run = 0; run < runs; ++run) {
  const order: Mode[] = run % 2 ? ["v8", "native"] : ["native", "v8"];
  const launches: Partial<Record<Mode, LaunchResult>> = {};
  for (const mode of order) launches[mode] = await measure(run, mode);
  const native = launches.native;
  const v8 = launches.v8;
  assert(native && v8);
  if (workload === "rows") assert.equal((native.result as unknown as RowsMeasurements).dom, (v8.result as unknown as RowsMeasurements).dom, "native and V8 must build the same rows");
  if (workload === "rows") {
    const [n, v] = [native, v8].map(engine => JSON.parse((engine.result as unknown as RowsMeasurements).structure!) as {counts: Record<string, number>; markup: string});
    assert.deepEqual(n.counts, v.counts, "native and V8 must build the same nodes");
    assert.equal(n.markup, v.markup, "native and V8 must build the same markup");
  }
  else assert.deepEqual(native.result.exactUnits, v8.result.exactUnits);
  measurements.push({run,order,native:native.result,v8:v8.result,launches:{native,v8}});
}
// GC pauses per launch, from the renderer's --trace-gc lines: `Scavenge` and
// the unified mark-compacts that collect Blink's Oilpan heap with V8's.
const gcPattern = /(Scavenge|Mark-Compact|Mark-Sweep)[^\n]*?([0-9.]+) \/ [0-9.]+ ms/;
const gc = traceGc ? await Promise.all(measurements.flatMap(run => (["native", "v8"] as const).map(async mode => {
  const text = await readFile(resolve(output, `launch-${run.run}-${mode}.log`), "utf8");
  const pauses = text.split("\n").map(line => line.match(gcPattern)).filter((match): match is RegExpMatchArray => match !== null);
  return {run: run.run, mode, collections: pauses.length, majors: pauses.filter(match => match[1] !== "Scavenge").length,
    pauseMs: +pauses.reduce((sum, match) => sum + Number(match[2]), 0).toFixed(1)};
}))) : undefined;
const percentile = (values:number[], fraction:number):number => values[Math.floor((values.length-1)*fraction)];
const provenance = {observedAt:new Date().toISOString(),workload,gc,diagnosticJsFlags,collection:workload === "rows" ? collection : undefined,backend,debugEngine,
  scope:debugEngine?"Diagnostic architecture comparison in debug Chromium; not a production performance claim":"Optimized static Chromium (no DCHECKs) architecture comparison; not an official/PGO distribution or whole-application speedup",
  argsText,cpu,runs,buildRecord,executable,executableSha256:hash(await readFile(executable)),fixtureSha256:hash(await readFile(fixturePath)),
  v8Executable,v8ExecutableSha256:hash(await readFile(v8Executable)),v8FixtureSha256:hash(await readFile(v8FixturePath)),
  chromiumRevision:execFileSync("git",["-C",source,"rev-parse","HEAD"],{encoding:"utf8"}).trim(),nativeManifestSha256:hash(await readFile(resolve(source,"nts/manifest.json"))),
  compilerCheck:JSON.parse(await readFile(resolve(root,"target/chromium/native-bootstrap/check-result.json"),"utf8")),
  cpuInfo:execFileSync("lscpu",[],{encoding:"utf8"})};
if (workload === "kernels") {
  const samplesOf = (result: Measurements) => (result as unknown as KernelsMeasurements).samples;
  const all = measurements.flatMap(run => [...samplesOf(run.native), ...samplesOf(run.v8)]);
  const median = (kernel: string, shape: string, lane: string) => {
    const values = all.filter(sample => sample.kernel === kernel && sample.shape === shape && sample.lane === lane)
      .map(sample => sample.nsPerOperation).sort((a,b) => a-b);
    return {samples:values.length,medianNs:percentile(values,.5),q1Ns:percentile(values,.25),q3Ns:percentile(values,.75)};
  };
  const summaries = [];
  for (const kernel of ["create-element", "detached-counter-tree"]) {
    for (const shape of ["loop", "per-call"]) {
      const intrinsic = median(kernel, shape, "blink-intrinsic"), compiled = median(kernel, shape, "compiled"), v8 = median(kernel, shape, "v8");
      summaries.push({kernel,shape,intrinsic,compiled,v8,compiledOverIntrinsic:compiled.medianNs/intrinsic.medianNs,compiledOverV8:compiled.medianNs/v8.medianNs});
    }
  }
  await writeFile(resolve(output,"result.json"),`${JSON.stringify({...provenance,
    methodology:{launchOrder:"Balanced native-first/V8-first",cases:"kernels_benchmark.cc and kernels-benchmark-v8 share one case table; kernels from native-typescript benchmarks/chromium",
      v8:"HTML-loaded vanilla JS in unmodified content_shell, normal JIT; no measured Runtime.evaluate application",
      timers:"Native TimeTicks and page performance.now around 20,000-iteration samples, one posted task per sample",
      limits:"compiled per-call pays one environment and DOM entry per call; native-typescript's per-call called the compiled function directly. Handles are leases released by hand"},
    measurements,summaries},null,2)}\n`);
  console.table(summaries.map(({kernel,shape,intrinsic,compiled,v8,compiledOverIntrinsic,compiledOverV8}) => ({kernel,shape,
    cppNs:+intrinsic.medianNs.toFixed(1),compiledNs:+compiled.medianNs.toFixed(1),v8Ns:+v8.medianNs.toFixed(1),
    compiledOverCpp:+compiledOverIntrinsic.toFixed(3),compiledOverV8:+compiledOverV8.toFixed(3)})));
} else if (workload === "rows") {
  const rowsOf = (result: Measurements) => (result as unknown as RowsMeasurements).samples;
  const summaries = [];
  for (const name of [...new Set(measurements.flatMap(run => rowsOf(run.native).map(sample => sample.case)))]) {
    const median = (engine: "native" | "v8") => {
      const samples = measurements.flatMap(run => rowsOf(run[engine])).filter(sample => sample.case === name);
      const values = samples.map(sample => sample.nsPerOperation).sort((a,b) => a-b);
      // A +layout sample also times its forced layouts alone; per operation.
      const layouts = samples.filter(sample => sample.layoutNs !== undefined).map(sample => sample.layoutNs!/sample.batch).sort((a,b) => a-b);
      return {samples:values.length,medianNs:percentile(values,.5),q1Ns:percentile(values,.25),q3Ns:percentile(values,.75),
        meanNs:values.reduce((sum,value) => sum+value,0)/values.length,
        layoutMedianNs:layouts.length ? percentile(layouts,.5) : undefined,
        ntsAllocationsPerOperation:samples[0].ntsAllocations===undefined?undefined:samples[0].ntsAllocations/samples[0].batch};
    };
    const native = median("native"), v8 = median("v8");
    summaries.push({case:name,native,v8,nativeOverV8:native.medianNs/v8.medianNs});
  }
  await writeFile(resolve(output,"result.json"),`${JSON.stringify({...provenance,
    methodology:{launchOrder:"Balanced native-first/V8-first",cases:"rows_benchmark.cc and rows-benchmark-v8 share one case table",
      v8:"HTML-loaded vanilla JS in unmodified content_shell, normal JIT; no measured Runtime.evaluate application",
      timers:"Native TimeTicks and page performance.now (coarsened in a file: page) around batches sized for multi-millisecond samples",
      limits:"Script time, plus forced style and layout in +layout cases; no paint; native pays one environment and DOM entry per operation, V8 one function call; native releases handles by hand"},
    measurements,summaries},null,2)}\n`);
  console.table(summaries.map(({case:name,native,v8,nativeOverV8}) => ({case:name,nativeUs:+(native.medianNs/1e3).toFixed(2),
    v8Us:+(v8.medianNs/1e3).toFixed(2),nativeOverV8:+nativeOverV8.toFixed(3),
    layoutNativeUs:native.layoutMedianNs===undefined?undefined:+(native.layoutMedianNs/1e3).toFixed(1),
    layoutV8Us:v8.layoutMedianNs===undefined?undefined:+(v8.layoutMedianNs/1e3).toFixed(1),ntsAllocations:native.ntsAllocationsPerOperation})));
} else {
  const all = measurements.flatMap(run => [...run.native.samples,...run.v8.samples]);
  const summaries=[];
  for (const payload of ["latin1","wide"]) for (const length of [16,256,4096]) {
    for (const path of [...new Set(all.map(sample=>sample.path))]) {
      const samples=all.filter(sample=>sample.payload===payload&&sample.length===length&&sample.path===path);
      if (!samples.length) continue;
      const values=samples.map(sample=>sample.nsPerOperation).sort((a,b)=>a-b);
      summaries.push({payload,length,path,samples:values.length,medianNs:percentile(values,.5),q1Ns:percentile(values,.25),q3Ns:percentile(values,.75),
        minSampleMs:Math.min(...samples.map(sample=>sample.elapsedNs))/1e6,
        ntsAllocationsPerOperation:samples[0].ntsAllocations===undefined?undefined:samples[0].ntsAllocations/samples[0].iterations,
        ntsRetainsPerOperation:samples[0].ntsRetains===undefined?undefined:samples[0].ntsRetains/samples[0].iterations});
    }
  }
  const allEntries = measurements.flatMap(run => run.native.entrySamples ?? []);
  const entrySummaries = [];
  for (const operationsPerEntry of [0,2,8,32]) for (const entry of ["legacy-per-call","legacy-scope","entered"]) {
    const samples = allEntries.filter(sample => sample.operationsPerEntry === operationsPerEntry && sample.entry === entry);
    const values = samples.map(sample => sample.nsPerEntry).sort((a,b) => a-b);
    entrySummaries.push({operationsPerEntry,entry,samples:values.length,medianNsPerEntry:percentile(values,.5),q1Ns:percentile(values,.25),q3Ns:percentile(values,.75),minSampleMs:Math.min(...samples.map(sample=>sample.elapsedNs))/1e6});
  }
  await writeFile(resolve(output,"result.json"),`${JSON.stringify({...provenance,
    methodology:{launchOrder:"Balanced native-first/V8-first",payloadOrder:"All three rotations, twice per six pairs",warmupOperations:16384,targetSampleMs:16,
      v8:"HTML-loaded application code in unmodified content_shell, normal JIT; no measured Runtime.evaluate application",timers:"Native TimeTicks and page performance.now; long samples reduce page-clock quantization; timings include native runtime counters",
      limits:"Text mutation microbenchmark, repeated and per-mutation strings; no layout/paint/startup claim; intrinsic Blink path omits binding semantics; native entry matrix has no V8 callback-latency equivalent"},
    measurements,summaries,entrySummaries},null,2)}\n`);
  console.table(summaries.map(({payload,length,path,medianNs,q1Ns,q3Ns,ntsAllocationsPerOperation})=>({payload,length,path,ns:Math.round(medianNs),q1:Math.round(q1Ns),q3:Math.round(q3Ns),ntsAllocationsPerOperation})));
  console.table(entrySummaries.map(({operationsPerEntry,entry,medianNsPerEntry})=>({operationsPerEntry,entry,nsPerEntry:Math.round(medianNsPerEntry)})));
}
if (gc) console.table(gc);
console.log(`Evidence: ${output}/result.json`);
