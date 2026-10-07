#!/usr/bin/env node
// Renderer-local architecture measurements; CDP stays outside timed loops.
import assert from "node:assert/strict";
import { openPage } from "./browser.ts";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { sha256File } from "./hash.ts";
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
interface KernelsMeasurements { samples: KernelsSample[]; status: number; liveRoots?: number; timing: string }
interface RowsMeasurements { samples: RowsSample[]; status: number; finalRows: number; liveRoots?: number; rootsAfterDestroy?: number; dom?: string; structure?: string; timing: string }
// The todo workload (--workload todo): one sample per user interaction,
// sent as real input over CDP and timed to the end of the next frame.
interface TodoSample { kind: string; index: number; ms: number }
// Handler time from the trace: Blink's EventDispatch slices on the renderer's
// main thread, by event type -- the listeners and the default handling, not
// the frame the interaction waits for.
interface DispatchTotals { [type: string]: { count: number; totalUs: number } }
interface TodoMeasurements { samples: TodoSample[]; status: number; dom: string; timing: string; dispatch?: DispatchTotals }
type Mode = "native" | "v8";
interface LaunchResult { result: Measurements; executable: string; fixture: string; args: string[]; rendererPid: number; rendererStatus: string; loadBefore: string; loadAfter: string }
const root = resolve(import.meta.dirname, "../..");
const executable = resolve(process.argv[2] ?? "third_party/chromium/src/out/NtsBaseline/nts_shell");
const output = resolve(process.argv[3] ?? "target/chromium/binding-benchmark");
const backend = process.argv[4];
assert(backend === "c" || backend === "llvm", "Usage: benchmark.ts <nts_shell> <output> <c|llvm> [--allow-debug] [--cpu N] [--runs N] [--workload binding|rows|kernels] [--collection idle|checkpoint] [--trace-gc] [--trace] [--profile-renderer]");
let runs = 6;
let cpu: number | undefined;
let workload: "binding" | "rows" | "kernels" | "todo" = "binding";
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
// --profile-renderer: `perf record` (user space, call graphs) on the measured
// renderer, from the click to the result, into perf-<run>-<mode>.data with a
// report beside it. Diagnostic: sampling costs time.
let profileRenderer = false;
const allowDebug = process.argv.includes("--allow-debug");
for (let i = 5; i < process.argv.length; ++i) {
  const option = process.argv[i];
  if (option === "--allow-debug") continue;
  if (option === "--cpu") cpu = Number(process.argv[++i]);
  else if (option === "--runs") runs = Number(process.argv[++i]);
  else if (option === "--trace-gc") traceGc = true;
  else if (option === "--trace") trace = true;
  else if (option === "--profile-renderer") profileRenderer = true;
  else if (option === "--diagnostic-js-flags") diagnosticJsFlags = process.argv[++i];
  else if (option === "--collection") {
    const value = process.argv[++i];
    assert(value === "checkpoint" || value === "idle", "--collection must be checkpoint or idle");
    collection = value;
  }
  else if (option === "--workload") {
    const value = process.argv[++i];
    assert(value === "binding" || value === "rows" || value === "kernels" || value === "todo", "--workload must be binding, rows, kernels or todo");
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
assert.equal(buildRecord.executableSha256, sha256File(executable), "Executable changed after building");
assert.equal(buildRecord.nativeManifestSha256, hash(await readFile(resolve(source, "nts/manifest.json"))), "Staging changed after building; rebuild first");
const fixturePath = resolve(root, `runtime/chromium/benchmarks/pages/${workload}/index.html`);
const v8Executable = resolve(dirname(executable), "content_shell");
const v8FixturePath = resolve(root, `runtime/chromium/benchmarks/pages/${workload}-v8/index.html`);
assert.equal(buildRecord.v8ControlExecutableSha256, sha256File(v8Executable), "Build the unmodified V8 control with the same profile");
await mkdir(output, {recursive:true});
const measurements: Array<{ run: number; order: Mode[]; native: Measurements; v8: Measurements; launches: Record<Mode, LaunchResult> }> = [];

// The kernels workload's kernels, in kernels_benchmark.cc's case order.
const KERNELS = ["create-element", "detached-counter-tree", "event-round-trip", "canvas-rects"];
interface Profile { child: ReturnType<typeof spawn>; data: string; stderr: string[] }
// Attaches to one process: user-space cycles with frame-pointer call graphs
// (Chromium keeps frame pointers). An attach the sandbox refuses fails here,
// rather than leaving an empty profile to be read as a result.
async function startProfile(pid: number, data: string): Promise<Profile> {
  const child = spawn("perf", ["record", "-q", "-e", "cycles:u", "-g", "-F", "2999", "-p", String(pid), "-o", data], {stdio:["ignore","ignore","pipe"]});
  const stderr: string[] = [];
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));
  await delay(300);
  assert.equal(child.exitCode, null, `perf could not attach to renderer ${pid}: ${stderr.join("")}`);
  return {child, data, stderr};
}
async function stopProfile(profile: Profile, report: string): Promise<void> {
  const exited = new Promise<void>((done) => profile.child.on("exit", () => done()));
  profile.child.kill("SIGINT");
  await exited;
  // Flat, per symbol, the main thread only: what the measured work spends.
  // A full call-graph report of a whole renderer took longer than the run.
  const text = execFileSync("perf", ["report", "-i", profile.data, "--no-children", "--stdio", "--percent-limit", "0.3",
    "--sort", "symbol", "-g", "none", "--comms", "nts_shell,content_shell"], {encoding:"utf8", maxBuffer: 256 << 20});
  await writeFile(report, text);
}
// EventDispatch per event type in one renderer's trace: complete events
// ("X") carry their duration; begin/end pairs are matched per thread.
function dispatchTotals(text: string, pid: number): DispatchTotals {
  const parsed = JSON.parse(text) as {traceEvents?: Array<{name:string; ph:string; pid:number; tid:number; ts:number; dur?:number; args?:{data?:{type?:string}}}>};
  const events = (parsed.traceEvents ?? []).filter(event => event.pid === pid && event.name === "EventDispatch");
  const totals: DispatchTotals = {};
  const open = new Map<number, Array<{ts:number; type:string}>>();
  const add = (type: string, us: number) => {
    const entry = totals[type] ?? (totals[type] = {count: 0, totalUs: 0});
    entry.count += 1;
    entry.totalUs += us;
  };
  for (const event of events.sort((a, b) => a.ts - b.ts)) {
    const type = event.args?.data?.type ?? "?";
    if (event.ph === "X") add(type, event.dur ?? 0);
    else if (event.ph === "B") (open.get(event.tid) ?? open.set(event.tid, []).get(event.tid)!).push({ts: event.ts, type});
    else if (event.ph === "E") {
      const begun = open.get(event.tid)?.pop();
      if (begun) add(begun.type, event.ts - begun.ts);
    }
  }
  return totals;
}

// The TodoMVC scenario, identical for both engines: add 30 todos by typing
// and pressing Enter, complete every third, filter three ways, destroy every
// fifth, toggle all twice, clear completed. Each interaction is real input
// (Input.dispatch*, acknowledged once the renderer has handled it) and ends
// with the next frame; the harness's own queries -- where to click, scrolling
// it into view -- are outside the timed span.
type Cdp = <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
async function driveTodo(mode: Mode, cdp: Cdp, evaluate: <T>(expression: string) => Promise<T>): Promise<TodoMeasurements> {
  const app = mode === "native" ? "#native-todo" : "#v8-todo";
  const samples: TodoSample[] = [];
  const frame = () => cdp("Runtime.evaluate", {expression:"new Promise(done => requestAnimationFrame(() => setTimeout(done, 0)))", awaitPromise:true});
  const locate = (selector: string) => evaluate<{x:number;y:number}>(`(() => {
    const node = document.querySelector(${JSON.stringify(`${app} ${selector}`)});
    node.scrollIntoView({block: "center"});
    const r = node.getBoundingClientRect();
    return {x: r.x + r.width / 2, y: r.y + r.height / 2};
  })()`);
  const click = async (point: {x:number;y:number}) => {
    for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", {type,...point,button:"left",clickCount:1});
  };
  const timed = async (kind: string, index: number, action: () => Promise<unknown>) => {
    const started = performance.now();
    await action();
    await frame();
    samples.push({kind, index, ms: performance.now() - started});
  };
  const count = (selector: string) => evaluate<number>(`document.querySelectorAll(${JSON.stringify(`${app} ${selector}`)}).length`);
  await click(await locate(".new-todo"));
  await frame();
  for (let i = 1; i <= 30; ++i) {
    await cdp("Input.insertText", {text: `Todo ${i}`});
    await timed("add", i, async () => {
      for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", {type, key:"Enter", code:"Enter", windowsVirtualKeyCode:13, nativeVirtualKeyCode:13, ...(type === "keyDown" ? {text:"\r"} : {})});
    });
  }
  assert.equal(await count(".todo-list li"), 30, `${mode}: Enter must add a todo through the input's change event`);
  for (let i = 3; i <= 30; i += 3) {
    const point = await locate(`.todo-list li:nth-child(${i}) .toggle`);
    await timed("toggle", i, () => click(point));
  }
  assert.equal(await count(".todo-list li.completed"), 10);
  for (const [index, name] of [[1, "active"], [2, "completed"], [0, "all"]] as const) {
    const point = await locate(`.filters li:nth-child(${index + 1}) button`);
    await timed(`filter-${name}`, index, () => click(point));
  }
  for (let i = 5; i <= 30; i += 5) {
    // Every fifth of the original thirty: rows shift up as each goes.
    const point = await locate(`.todo-list li:nth-child(${i - (i / 5 - 1)}) .destroy`);
    await timed("destroy", i, () => click(point));
  }
  assert.equal(await count(".todo-list li"), 24);
  for (const pass of [1, 2]) {
    const point = await locate(".toggle-all");
    await timed("toggle-all", pass, () => click(point));
  }
  assert.equal(await count(".todo-list li.completed"), 0);
  for (let i = 2; i <= 24; i += 4) {
    const point = await locate(`.todo-list li:nth-child(${i}) .toggle`);
    await timed("toggle", 100 + i, () => click(point));
  }
  const point = await locate(".clear-completed");
  await timed("clear", 0, () => click(point));
  assert.equal(await count(".todo-list li"), 18);
  const dom = await evaluate<string>(`document.querySelector(${JSON.stringify(app)}).innerHTML`);
  return {samples, status: 0, dom, timing: "dispatch to the end of the next frame, harness-side performance.now"};
}

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
  const args = ["--disable-features=SpareRendererForSitePerProcess", "--enable-logging=stderr"];
  if (mode === "native") args.push(`--nts-probe-url=${fixture}`, `--nts-benchmark-order=${run % 3}`);
  if (mode === "native" && workload === "rows") args.push(`--nts-collection=${collection}`);
  const jsFlags = [...(traceGc ? ["--trace-gc"] : []), ...(diagnosticJsFlags ? [diagnosticJsFlags] : [])];
  if (jsFlags.length) args.push(`--js-flags=${jsFlags.join(" ")}`);
  const page = await openPage(engine, fixture, {
    profile, args, target: target => target.url === fixture,
    failure: /FATAL:|Check failed|nts host: check failed|NTS_.*unexpectedly ran/,
    callTimeout: 60_000, waitTimeout: 60_000,
  });
  const { cdp, evaluate } = page;
  const until = <T>(predicate: () => T | Promise<T>): Promise<NonNullable<T>> => page.until(predicate, `the ${mode} benchmark (see ${output}/launch-${run}-${mode}.log)`);
  let traceStream: string | undefined;
  page.on("Tracing.tracingComplete", params => { traceStream = (params.stream as string | undefined) ?? ""; });
  try {
    await until(() => evaluate<boolean>(`location.href === ${JSON.stringify(fixture)} && document.querySelector('#benchmark-result')?.getAttribute('data-state') === 'ready'`));
    const renderers = await rendererDescendants(page.pid, engine);
    assert.equal(renderers.length, 1, "Require an unambiguous measured renderer; do not guess among spare processes");
    const rendererPid = renderers[0];
    if (mode === "native") assert.equal(rendererPid, Number(page.log().match(/^\[(\d+):[^\]]+\][^\n]*NTS_PROBE attach/m)?.[1]));
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
    if (workload === "todo") {
      const profile = profileRenderer ? await startProfile(rendererPid, resolve(output, `perf-${run}-${mode}.data`)) : undefined;
      await cdp("Tracing.start", {transferMode:"ReturnAsStream", traceConfig:{recordMode:"recordAsMuchAsPossible",
        includedCategories:["devtools.timeline"]}});
      const result = await driveTodo(mode, cdp, evaluate);
      await cdp("Tracing.end");
      const stream = await until(() => traceStream);
      const chunks: string[] = [];
      for (;;) {
        const chunk = await cdp<{data:string; base64Encoded?:boolean; eof:boolean}>("IO.read", {handle:stream, size:1 << 20});
        chunks.push(chunk.base64Encoded ? Buffer.from(chunk.data, "base64").toString("utf8") : chunk.data);
        if (chunk.eof) break;
      }
      await cdp("IO.close", {handle:stream});
      result.dispatch = dispatchTotals(chunks.join(""), rendererPid);
      if (profile) await stopProfile(profile, resolve(output, `perf-${run}-${mode}.txt`));
      console.log(`Run ${run+1}/${runs}, ${mode}: ${result.samples.length} interactions; normal JIT, sandbox active`);
      return {result:result as unknown as Measurements,executable:engine,fixture,args,rendererPid,rendererStatus,loadBefore,loadAfter:(await readFile("/proc/loadavg","utf8")).trim()};
    }
    const selector = `#${mode}-${workload === "binding" ? "benchmark" : workload}-run`;
    const point = await evaluate<{x:number;y:number}>(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    if (trace) await cdp("Tracing.start", {transferMode:"ReturnAsStream", traceConfig:{recordMode:"recordAsMuchAsPossible",
      includedCategories:["devtools.timeline","disabled-by-default-devtools.timeline","blink.user_timing","v8.gc","disabled-by-default-v8.gc","blink_gc","cppgc"]}});
    const profile = profileRenderer ? await startProfile(rendererPid, resolve(output, `perf-${run}-${mode}.data`)) : undefined;
    for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", {type,...point,button:"left",clickCount:1});
    await until(() => evaluate<boolean>("document.querySelector('#benchmark-result').getAttribute('data-state') === 'done'"));
    if (profile) await stopProfile(profile, resolve(output, `perf-${run}-${mode}.txt`));
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
      // Each kernel x two shapes x twenty samples, per lane: two lanes native.
      assert.equal(kernels.samples.length, KERNELS.length * 2 * 20 * (mode === "native" ? 2 : 1));
      if (mode === "native") {
        assert.equal(kernels.liveRoots, 0, "a kernel must root nothing");
        // The DOM kernels allocate nothing of the program's; an event round
        // trip makes its listener's closure and state once per listen.
        for (const sample of kernels.samples.filter(sample => sample.lane === "compiled" && sample.kernel !== "event-round-trip"))
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
      // tbody + template + (tr, label text) per row: the nodes the app keeps.
      if (mode === "native") assert.equal(rows.liveRoots, 2 + 2 * rows.finalRows, "native handles leaked");
      if (mode === "native") assert.equal(rows.rootsAfterDestroy, 0, "destroying the app must leave no root");
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
    // Three lengths x seven rounds x (six Latin-1 rows + five wide); the entry
    // matrix is four operation counts (even, so each ends on B) x seven rounds.
    assert.equal(result.samples.length, mode === "native" ? 231 : 84);
    if (mode === "native") assert.equal(result.entrySamples?.length, 28);
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
    page.kill();
    await writeFile(resolve(output, `launch-${run}-${mode}.log`), page.log());
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
const provenance = {observedAt:new Date().toISOString(),workload,gc,diagnosticJsFlags,profiledRenderer:profileRenderer || undefined,traced:trace || undefined,collection:workload === "rows" ? collection : undefined,backend,debugEngine,
  scope:debugEngine?"Diagnostic architecture comparison in debug Chromium; not a production performance claim":"Optimized static Chromium (no DCHECKs) architecture comparison; not an official/PGO distribution or whole-application speedup",
  argsText,cpu,runs,buildRecord,executable,executableSha256:sha256File(executable),fixtureSha256:hash(await readFile(fixturePath)),
  v8Executable,v8ExecutableSha256:sha256File(v8Executable),v8FixtureSha256:hash(await readFile(v8FixturePath)),
  chromiumRevision:execFileSync("git",["-C",source,"rev-parse","HEAD"],{encoding:"utf8"}).trim(),nativeManifestSha256:hash(await readFile(resolve(source,"nts/manifest.json"))),
  compilerCheck:JSON.parse(await readFile(resolve(root,"target/chromium/native-bootstrap/check-result.json"),"utf8")),
  cpuInfo:execFileSync("lscpu",[],{encoding:"utf8"})};
if (workload === "todo") {
  const samplesOf = (result: Measurements) => (result as unknown as TodoMeasurements).samples;
  for (const run of measurements) assert.equal((run.native as unknown as TodoMeasurements).dom, (run.v8 as unknown as TodoMeasurements).dom, "both engines must build the same app DOM");
  const summaries = [];
  for (const kind of [...new Set(measurements.flatMap(run => samplesOf(run.native).map(sample => sample.kind)))]) {
    const median = (engine: Mode) => {
      const values = measurements.flatMap(run => samplesOf(run[engine])).filter(sample => sample.kind === kind).map(sample => sample.ms).sort((a,b) => a-b);
      return {samples: values.length, medianMs: percentile(values,.5), q1Ms: percentile(values,.25), q3Ms: percentile(values,.75)};
    };
    const native = median("native"), v8 = median("v8");
    summaries.push({kind, native, v8, nativeOverV8: native.medianMs / v8.medianMs});
  }
  const totals = (engine: Mode) => measurements.map(run => samplesOf(run[engine]).reduce((sum, sample) => sum + sample.ms, 0)).sort((a,b) => a-b);
  await writeFile(resolve(output,"result.json"),`${JSON.stringify({...provenance,
    methodology:{launchOrder:"Balanced native-first/V8-first",scenario:"driveTodo in benchmark.ts: 30 adds, 16 toggles, 3 filters, 6 destroys, 2 toggle-alls, 1 clear",
      v8:"HTML-loaded vanilla JS in unmodified content_shell, normal JIT",
      timers:"Harness performance.now from the first CDP input event to the end of the next frame; includes CDP and IPC, equally for both engines",
      limits:"End-to-end interaction latency, not script time alone: input routing, the handler, style, layout and paint are all inside"},
    measurements,summaries,totals:{nativeMs:totals("native"),v8Ms:totals("v8")}},null,2)}\n`);
  console.table(summaries.map(({kind,native,v8,nativeOverV8}) => ({kind,samples:native.samples,nativeMs:+native.medianMs.toFixed(3),v8Ms:+v8.medianMs.toFixed(3),nativeOverV8:+nativeOverV8.toFixed(3)})));
  console.log(`Total per run: native ${totals("native").map(ms => ms.toFixed(1)).join(", ")} ms; V8 ${totals("v8").map(ms => ms.toFixed(1)).join(", ")} ms (frame-bound: each interaction waits for its frame)`);
  // Handler time, which the frame hides: mean EventDispatch per event type,
  // over all runs, for the types the app listens to.
  const dispatchOf = (engine: Mode, type: string) => {
    const all = measurements.map(run => (run[engine] as unknown as TodoMeasurements).dispatch?.[type]).filter(Boolean) as Array<{count:number; totalUs:number}>;
    const count = all.reduce((sum, entry) => sum + entry.count, 0);
    return count ? all.reduce((sum, entry) => sum + entry.totalUs, 0) / count : NaN;
  };
  console.table(["change", "click", "keydown", "input"].map(type => ({type, nativeUs:+dispatchOf("native", type).toFixed(1), v8Us:+dispatchOf("v8", type).toFixed(1),
    nativeOverV8:+(dispatchOf("native", type) / dispatchOf("v8", type)).toFixed(3)})));
} else if (workload === "kernels") {
  const samplesOf = (result: Measurements) => (result as unknown as KernelsMeasurements).samples;
  const all = measurements.flatMap(run => [...samplesOf(run.native), ...samplesOf(run.v8)]);
  const median = (kernel: string, shape: string, lane: string) => {
    const values = all.filter(sample => sample.kernel === kernel && sample.shape === shape && sample.lane === lane)
      .map(sample => sample.nsPerOperation).sort((a,b) => a-b);
    return {samples:values.length,medianNs:percentile(values,.5),q1Ns:percentile(values,.25),q3Ns:percentile(values,.75)};
  };
  const summaries = [];
  for (const kernel of KERNELS) {
    for (const shape of ["loop", "per-call"]) {
      const intrinsic = median(kernel, shape, "blink-intrinsic"), compiled = median(kernel, shape, "compiled"), v8 = median(kernel, shape, "v8");
      summaries.push({kernel,shape,intrinsic,compiled,v8,compiledOverIntrinsic:compiled.medianNs/intrinsic.medianNs,compiledOverV8:compiled.medianNs/v8.medianNs});
    }
  }
  await writeFile(resolve(output,"result.json"),`${JSON.stringify({...provenance,
    methodology:{launchOrder:"Balanced native-first/V8-first",cases:"kernels_benchmark.cc and kernels-benchmark-v8 share one case table; kernels from native-typescript benchmarks/chromium",
      v8:"HTML-loaded vanilla JS in unmodified content_shell, normal JIT; no measured Runtime.evaluate application",
      timers:"Native TimeTicks and page performance.now around 20,000-iteration samples, one posted task per sample",
      limits:"compiled per-call pays one environment and DOM entry per call; native-typescript's per-call called the compiled function directly. Nodes are Blink pointers; only those the program keeps are rooted"},
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
      limits:"Script time, plus forced style and layout in +layout cases; no paint; native pays one environment and DOM entry per operation, V8 one function call; nodes the app keeps are rooted by the compiler"},
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
  for (const operationsPerEntry of [0,2,8,32]) for (const entry of ["entered"]) {
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
