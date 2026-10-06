#!/usr/bin/env node
// Exercise the actual content_shell under Xvfb, directly with Node 24.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

interface PageTarget { type: string; url: string; webSocketDebuggerUrl: string }
interface Evaluation { exceptionDetails?: unknown; result: { value?: unknown } }
interface Layout { title: string; count: string; x: number; y: number; width: number; background: string }
interface PendingCall { accept: (result: unknown) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }
const errorCode = (error: unknown): string => error instanceof Error && "code" in error ? String(error.code) : "unknown";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const executable = resolve(process.argv[2] ?? `${root}/third_party/chromium/src/out/NtsBaseline/content_shell`);
const output = resolve(process.argv[3] ?? `${root}/target/chromium/baseline-smoke`);
const domOracle = process.argv[4] === "v8";
const probeBackend = domOracle ? undefined : process.argv[4];
if (probeBackend !== undefined && probeBackend !== "c" && probeBackend !== "llvm") {
  throw new Error("Fourth argument must be c or llvm for the native probe");
}
const mixedMicrotasks = process.argv[5] === "microtasks";
const nativeDom = process.argv[5] === "dom" || mixedMicrotasks;
const nativeCounter = process.argv[5] === "counter" || nativeDom;
if (process.argv[5] !== undefined && !nativeCounter) throw new Error("Fifth argument must be counter, dom or microtasks");
if (nativeCounter && !probeBackend && !domOracle) throw new Error("The native counter requires a probe backend");
if (domOracle && !nativeDom) throw new Error("The v8 oracle requires fifth argument dom");
const fixtureName = mixedMicrotasks ? (domOracle ? "native-microtasks-oracle" : "native-microtasks") : domOracle ? "native-dom-oracle" : nativeDom ? "native-dom" : nativeCounter ? "native-counter" : "baseline";
const fixture = pathToFileURL(`${root}/runtime/chromium/fixtures/${fixtureName}/index.html`).href;
const inputSelector = nativeCounter ? "#native-increment" : "#increment";
const outputSelector = nativeDom ? "#native-dom-count" : nativeCounter ? "#native-count" : "#count";
const expectedCount = (count: number): string => nativeCounter && !nativeDom ? String(count) : `Count: ${count}`;
const readCount = `document.querySelector('${outputSelector}').${nativeCounter && !nativeDom ? "getAttribute('data-count')" : "textContent"}`;
// Inspection/test instrumentation shared verbatim between NTS and V8 runs.
// It observes actual CE reactions and MutationObserver delivery, and adds V8
// promise jobs before/after the native input listener by changing capture.
const mixedObserver = `(() => {
  window.mixedTrace = [];
  const jobs = document.querySelector('#native-jobs');
  customElements.define('nts-job-trace', class extends HTMLElement {
    static get observedAttributes() { return ['data-jobs']; }
    attributeChangedCallback(name, oldValue, value) {
      if (value) window.mixedTrace.push('ce:' + value);
    }
  });
  const observer = new MutationObserver(records => {
    if (records.length && jobs.getAttribute('data-jobs')) window.mixedTrace.push('mo:' + jobs.getAttribute('data-jobs'));
  });
  observer.observe(jobs, {attributes:true, attributeFilter:['data-jobs']});
  const input = document.querySelector('#native-increment');
  const mark = tag => { const value=jobs.getAttribute('data-jobs'); jobs.setAttribute('data-jobs',value+(value?',':'')+tag); };
  const listener = () => Promise.resolve().then(() => {
    mark('v8-1'); Promise.resolve().then(() => mark('v8-nested'));
  });
  window.prepareMixed = before => {
    input.removeEventListener('input', listener, false);
    input.removeEventListener('input', listener, true);
    input.addEventListener('input', listener, before);
    jobs.setAttribute('data-jobs', ''); observer.takeRecords(); window.mixedTrace=[];
  };
})()`;
const chromiumSource = resolve(root, "third_party/chromium/src");
const chromiumRevision = execFileSync("git", ["-C", chromiumSource, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const sourceDiff = execFileSync("git", ["-C", chromiumSource, "diff", "HEAD", "--binary"], { encoding: "utf8" });
assert.equal(sourceDiff, "", "The baseline/public-client experiment requires unmodified tracked Chromium source");
assert.equal(basename(executable), probeBackend ? "nts_shell" : "content_shell");
const gnArgs = await readFile(resolve(dirname(executable), "args.gn"), "utf8");
if (probeBackend) assert(gnArgs.includes(`nts_probe_backend = "${probeBackend}"`), "GN backend must match the requested native probe");
await mkdir(output, { recursive: true });
const targetLabel = probeBackend ? "//nts:nts_shell" : "//content/shell:content_shell";
const runtimeDeps = execFileSync(resolve(chromiumSource, "buildtools/linux64/gn"),
  ["desc", relative(chromiumSource, dirname(executable)), targetLabel, "runtime_deps"], { cwd: chromiumSource, encoding: "utf8" });
await writeFile(`${output}/runtime-deps.txt`, runtimeDeps);
const nativeManifestSha256 = probeBackend ? createHash("sha256").update(await readFile(resolve(chromiumSource, "nts/manifest.json"))).digest("hex") : undefined;
const profile = await mkdtemp(`${output}/profile-`);
const launchLog = createWriteStream(`${output}/launch.log`);
const started = performance.now();
const args = ["--ozone-platform=x11", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", `--user-data-dir=${profile}`, fixture];
if (nativeDom) args.unshift("--js-flags=--expose-gc");
if (probeBackend) args.unshift("--enable-logging=stderr", `--nts-probe-url=${fixture}`);
const child = spawn("xvfb-run", ["-a", "-s", "-screen 0 1280x900x24", executable, ...args], {
  detached: true, stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
let exited = false;
let launchError: Error | undefined;
child.on("error", (error) => { launchError = error; });
child.on("exit", () => { exited = true; });
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => { log += chunk.toString(); launchLog.write(chunk); });
}

async function until<T>(predicate: () => T | Promise<T>, label: string, timeout = 30_000): Promise<NonNullable<T>> {
  const deadline = performance.now() + timeout;
  do {
    if (launchError) throw launchError;
    if (exited) throw new Error(`content_shell exited while waiting for ${label}; see ${output}/launch.log`);
    const value = await predicate();
    if (value) return value as NonNullable<T>;
    await delay(100);
  } while (performance.now() < deadline);
  throw new Error(`Timed out waiting for ${label}; see ${output}/launch.log`);
}

async function processes() {
  const records = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      // Chromium rewrites argv into one process-title string on Linux, so
      // /proc/cmdline does not necessarily preserve its original NUL splits.
      const commandLine = (await readFile(`/proc/${entry}/cmdline`, "utf8")).replaceAll("\0", " ").trim();
      if (commandLine !== executable && !commandLine.startsWith(`${executable} `)) continue;
      const type = commandLine.match(/(?:^|\s)--type=([^\s]+)/)?.[1] ?? "browser";
      const status = Object.fromEntries((await readFile(`/proc/${entry}/status`, "utf8")).trim().split("\n").map((line) => {
        const colon = line.indexOf(":");
        return [line.slice(0, colon), line.slice(colon + 1).trim()];
      }));
      // Only this launch's descendants, including renderers forked by zygotes.
      let parent = Number(status.PPid);
      const seen = new Set();
      while (parent > 1 && parent !== child.pid && !seen.has(parent)) {
        seen.add(parent);
        const parentStatus = await readFile(`/proc/${parent}/status`, "utf8");
        parent = Number(parentStatus.match(/^PPid:\s+(\d+)/m)?.[1] ?? 0);
      }
      if (parent !== child.pid) continue;
      const namespaces: Record<string, string> = {};
      for (const namespace of ["user", "pid", "net", "mnt"]) {
        try { namespaces[namespace] = await readlink(`/proc/${entry}/ns/${namespace}`); }
        catch (error) { namespaces[namespace] = `unavailable: ${errorCode(error)}`; }
      }
      records.push({ pid: Number(entry), commandLine, type, status, namespaces });
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes(errorCode(error))) throw error;
    }
  }
  return records;
}

let socket: WebSocket | undefined;
try {
  const endpoint = await until(() => log.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], "DevTools");
  const origin = `http://${new URL(endpoint).host}`;
  const page = await until(async () => {
    const pages = await (await fetch(`${origin}/json/list`)).json() as PageTarget[];
    return pages.find((item) => item.type === "page" && item.url === fixture);
  }, "fixture target");
  const connection = new WebSocket(page.webSocketDebuggerUrl);
  socket = connection;
  await new Promise<void>((accept, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out opening DevTools")), 10_000);
    connection.addEventListener("open", () => { clearTimeout(timeout); accept(); }, { once: true });
    connection.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Cannot open DevTools")); }, { once: true });
  });
  let nextId = 0;
  let rendererCrashed = false;
  const pending = new Map<number, PendingCall>();
  connection.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data)) as { id?: number; method?: string; error?: unknown; result?: unknown };
    if (message.method === "Inspector.targetCrashed") rendererCrashed = true;
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timeout);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.accept(message.result);
  });
  connection.addEventListener("close", () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(new Error("DevTools connection closed"));
    }
    pending.clear();
  });
  function cdp<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise<T>((accept, reject) => {
      const id = ++nextId;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 10_000);
      pending.set(id, { accept: (value) => accept(value as T), reject, timeout });
      connection.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate<T>(expression: string): Promise<T> {
    const result = await cdp<Evaluation>("Runtime.evaluate", { expression, returnByValue: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value as T;
  }
  await cdp("Page.enable");
  if (probeBackend) await cdp("Inspector.enable");
  // A target reports its requested URL while its initial about:blank document
  // can still be complete. Wait for the committed fixture and its control.
  await until(() => evaluate<boolean>(`location.href === ${JSON.stringify(fixture)} && document.readyState === 'complete' && document.querySelector('${inputSelector}') !== null && document.querySelector('${outputSelector}') !== null`), "loaded fixture document");
  const readyMs = performance.now() - started;
  // The differential vectors (program/src/idl-vectors.ts): the
  // program ran them through the generated bindings while the page loaded;
  // the oracle runs the same source, types stripped, through V8's, and
  // leaves its transcript in the same place, so the compared DOM holds both
  // answers. `asText` and the like are the program's narrowing, which page
  // script spells `instanceof`.
  if (domOracle && !mixedMicrotasks) {
    const vectors = stripTypeScriptTypes(await readFile(resolve(root, "runtime/chromium/program/src/idl-vectors.ts"), "utf8"))
      .replace(/^\s*import\s[^;]*;\s*$/gm, "").replace(/^export /gm, "");
    await evaluate(`(() => {
      const asHTMLElement = (node) => node instanceof HTMLElement ? node : null;
      const asHTMLInputElement = (node) => node instanceof HTMLInputElement ? node : null;
      const asText = (node) => node instanceof Text ? node : null;
      ${vectors}
      // V8's message carries the binding's context ("Failed to execute 'x'
      // on 'Y': "), which the generated binding's does not.
      const failure = (error) => error.name + ": " + error.message
        .replace(/^Failed to (?:execute '[^']*'|set the '[^']*' property|read the '[^']*' property) on '[^']*': /, "");
      const container = document.querySelector('#native-dom');
      const section = document.createElement('section');
      container.appendChild(section);
      const transcript = idlTranscript(document, section, { failure });
      const pre = document.createElement('pre');
      pre.id = 'native-idl';
      pre.textContent = transcript;
      container.appendChild(pre);
    })()`);
  }
  const before = await evaluate<Layout>(`(() => {
    const r = document.querySelector('${inputSelector}').getBoundingClientRect();
    return {title: document.title, count: ${readCount},
      x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width,
      background: getComputedStyle(document.body).backgroundColor};
  })()`);
  assert.equal(before.title, nativeDom ? "NTS native DOM counter" : nativeCounter ? "NTS native input counter" : "NTS Chromium baseline");
  assert.equal(before.count, expectedCount(0));
  assert(before.width > 0, "Blink must lay out a visible input control");
  async function click() {
    for (const type of ["mousePressed", "mouseReleased"]) {
      await cdp("Input.dispatchMouseEvent", { type, x: before.x, y: before.y, button: "left", clickCount: 1 });
    }
  }
  const mixedTraces: Array<{ order: string; source: string; jobs: string; reactions: string[] }> = [];
  async function captureMixed(step: number) {
    const jobs = await evaluate<string>("document.querySelector('#native-jobs').getAttribute('data-jobs')");
    const first = 3 * (step - 1) + 1;
    const order = step <= 5 ? "native-first" : "v8-first";
    const scriptDispatch = step % 2 === 0;
    const nativeJobs = [`native-${first}`, `native-${first+1}`, `native-${first+2}`];
    const expected = scriptDispatch ? (step <= 5 ? [nativeJobs[0], "v8-1", nativeJobs[1], "v8-nested", nativeJobs[2]] : ["v8-1", nativeJobs[0], "v8-nested", nativeJobs[1], nativeJobs[2]]) : (step <= 5 ? [...nativeJobs, "v8-1", "v8-nested"] : ["v8-1", "v8-nested", ...nativeJobs]);
    assert.deepEqual(jobs.split(','), expected, `shared document-agent queue: ${order}`);
    const reactions = await evaluate<string[]>("window.mixedTrace");
    assert.equal(reactions.filter(trace => trace.startsWith('ce:')).length, 5);
    assert(reactions.some(trace => trace.startsWith('mo:')), "MutationObserver must run on the same checkpoint");
    mixedTraces.push({order, source: scriptDispatch ? "script-dispatch" : "user-input", jobs, reactions});
  }
  if (mixedMicrotasks) {
    await evaluate(mixedObserver);
    await evaluate("window.prepareMixed(false)");
  }
  await click();
  const after = await evaluate<string>(readCount);
  assert.equal(after, expectedCount(1), "input must invoke the selected event listener");
  if (mixedMicrotasks) await captureMixed(1);
  let counter;
  if (nativeCounter) {
    const scripts = await evaluate<number>("document.scripts.length");
    assert.equal(scripts, domOracle ? 1 : 0, "fixture must have the declared application script count");
    for (let step = 2; step <= 10; ++step) {
      if (mixedMicrotasks) await evaluate(`window.prepareMixed(${step > 5})`);
      if (mixedMicrotasks && step % 2 === 0) await evaluate("document.querySelector('#native-increment').dispatchEvent(new Event('input', {bubbles:true}))");
      else await click();
      assert.equal(await evaluate<string>(readCount), expectedCount(step));
      if (mixedMicrotasks) await captureMixed(step);
    }
    const visibleContent = await evaluate<string>(nativeDom ? readCount : `getComputedStyle(document.querySelector('${outputSelector}'), '::after').content`);
    assert.equal(visibleContent, nativeDom ? expectedCount(10) : '"10"', "Blink must display the native-updated counter");
    if (!domOracle) await until(() => (log.match(mixedMicrotasks ? /NTS_ASYNC count=\d+ live=\d+/g : new RegExp(`NTS_COUNTER backend=${probeBackend} count=\\d+ live=1`, "g")) ?? []).length === 10, "native counter trace");
    counter = { inputEvents: 10, applicationScripts: scripts, visibleContent, managedLiveObjectsPerEvent: domOracle || mixedMicrotasks ? undefined : 1, managedLiveObjectsAfterCheckpoint: !domOracle && mixedMicrotasks ? 1 : undefined };
  }
  let dom;
  if (nativeDom) {
    const exactUnits = await evaluate<number[]>(`Array.from(document.querySelector('${outputSelector}').getAttribute('data-exact'), c => c).join('').split('').map(c => c.charCodeAt(0))`);
    assert.deepEqual(exactUnits, [65, 0, 233, 937, 55296, 90, 56320, 55357, 56832]);
    const html = await evaluate<string>("document.querySelector('#native-dom').outerHTML");
    if (domOracle) assert.equal(await evaluate<number>("window.domWitness"), 0);
    else await until(() => log.includes(`NTS_DOM backend=${probeBackend} result=0 roots=0`), "native DOM identity/error/string witnesses");
    dom = { html, exactUnits, result: 0, exceptionCodes: { SyntaxError: 12, HierarchyRequestError: 3, NotFoundError: 8, InvalidCharacterError: 5 }, execution: domOracle ? "v8" : probeBackend };
  }
  const capture = await cdp<{ data: string }>("Page.captureScreenshot", { format: "png" });
  await writeFile(`${output}/screenshot.png`, Buffer.from(capture.data, "base64"));
  const records = await processes();
  const browser = records.find((item) => item.type === "browser");
  const renderers = records.filter((item) => item.type === "renderer");
  assert(browser, "separate browser process must be observable");
  assert(renderers.length > 0, "renderer process must be observable");
  for (const renderer of renderers) {
    assert.notEqual(renderer.pid, browser.pid);
    assert.equal(renderer.status.Seccomp, "2", "renderer must have a seccomp filter");
    assert.equal(renderer.status.NoNewPrivs, "1", "renderer must prevent privilege gain");
    assert(!/(?:^|\s)--(?:no-sandbox|disable-seccomp-filter-sandbox|disable-namespace-sandbox)(?:\s|=|$)/.test(renderer.commandLine));
    assert(renderer.status.NSpid.split(/\s+/).length > 1, "renderer must be in a nested PID namespace");
  }
  let lifecycle;
  if (probeBackend) {
    const attachments = () => (log.match(new RegExp(`NTS_PROBE attach backend=${probeBackend} scalar=50 text=native:probe live=0`, "g")) ?? []).length;
    const disposals = () => (log.match(new RegExp(`NTS_PROBE dispose backend=${probeBackend}`, "g")) ?? []).length;
    await until(() => attachments() === 1, "first native attachment");
    for (let reload = 0; reload < 3; ++reload) {
      const priorAttachments = attachments();
      const priorDisposals = disposals();
      await cdp("Page.reload");
      await until(() => attachments() === priorAttachments + 1 && disposals() === priorDisposals + 1, "native reload/disposal");
      if (nativeCounter) assert.equal(await evaluate<string>(readCount), expectedCount(0), "a fresh document must get a fresh native counter");
    }
    const priorDisposals = disposals();
    await cdp("Page.navigate", { url: "about:blank" });
    await until(() => disposals() === priorDisposals + 1, "native disposal on navigation");
    assert.equal(attachments(), 4, "unselected document must not attach native code");
    await cdp("Page.navigate", { url: fixture });
    await until(() => attachments() === 5, "native attachment on return");
    if (nativeCounter) assert.equal(await evaluate<string>(readCount), expectedCount(0));
    // The native log identifies the selected document's renderer. Abruptly
    // terminate that verified process; no shutdown callbacks can mask a leak
    // in the browser's process-lifetime handling. Avoid the debug Page.crash
    // path, which stalls in fatal/signal handling on this initial host.
    const nativePidPattern = new RegExp(`^\\[(\\d+):[^\\]]+\\][^\\n]*NTS_PROBE attach backend=${probeBackend}`, "gm");
    const rendererPid = Number([...log.matchAll(nativePidPattern)].at(-1)?.[1]);
    assert((await processes()).some((item) => item.pid === rendererPid && item.type === "renderer"), "native log PID must identify a live renderer before the crash");
    process.kill(rendererPid, "SIGKILL");
    await until(async () => {
      try { return /^State:\s+Z/m.test(await readFile(`/proc/${rendererPid}/status`, "utf8")); }
      catch (error) { if (["ENOENT", "ESRCH"].includes(errorCode(error))) return true; throw error; }
    }, "selected renderer process death");
    process.kill(browser.pid, 0);
    const browserResponse = await fetch(`${origin}/json/version`, { signal: AbortSignal.timeout(5_000) });
    assert(browserResponse.ok, "browser must survive a controlled renderer crash");
    lifecycle = { attachments: attachments(), disposals: disposals(), reloads: 3, rendererPid, terminationMethod: "SIGKILL to verified native-document renderer PID", rendererExited: true, inspectorCrashNotification: rendererCrashed, browserSurvivedRendererCrash: true };
  }
  if (mixedMicrotasks && !domOracle) {
    assert.equal((log.match(/NTS_NATIVE_TASK drop live=1/g) ?? []).length, 4, "each document disposal must drop its managed host task");
    assert.equal((log.match(/NTS_CHECKPOINT live=1/g) ?? []).length, 10, "each input must finish with one owned counter and no leaked jobs");
    assert(!log.includes("NTS_TEARDOWN"), "teardown must neither run canceled work nor leave a pending await");
  }
  const result = {
    executable, args, fixture, readyMs, before, after, processes: records,
    chromiumRevision, gnArgs, sourceDiffSha256: createHash("sha256").update(sourceDiff).digest("hex"),
    executableSha256: createHash("sha256").update(await readFile(executable)).digest("hex"),
    fixtureSha256: createHash("sha256").update(await readFile(fileURLToPath(fixture))).digest("hex"),
    nativeManifestSha256,
    runtimeResources: { targetLabel, manifest: `${output}/runtime-deps.txt`, method: "GN-declared runtime dependencies, including test fixtures; not a minimal distribution or a list of host system libraries." },
    probeBackend, lifecycle, counter, nativeDom, dom,
    microtasks: mixedMicrotasks ? {traces: mixedTraces, observerSha256: createHash('sha256').update(mixedObserver).digest('hex'), canceledJobs: domOracle ? undefined : (log.match(/NTS_NATIVE_TASK drop/g) ?? []).length, endCheckpoints: domOracle ? undefined : (log.match(/NTS_CHECKPOINT live=1/g) ?? []).length} : undefined,
    rssSumKiB: records.reduce((sum, item) => sum + Number(item.status.VmRSS?.split(/\s+/)[0] ?? 0), 0),
    memoryMethod: "Sum of per-process VmRSS; shared pages may be counted more than once.",
    display: "Xvfb 1280x900x24", observedAt: new Date().toISOString(),
    readyMethod: "Elapsed launch of xvfb-run to document.readyState=complete observed over CDP; includes Xvfb and inspection overhead, debug component profile.",
  };
  await writeFile(`${output}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`PASS: DOM/CSS, input, screenshot, separate renderer with seccomp and PID namespace (${Math.round(readyMs)} ms to ready)`);
  console.log(`Evidence: ${output}/result.json`);
  if (lifecycle) console.log(`PASS: ${probeBackend} native renderer execution, reload/navigation disposal, browser survives renderer crash`);
  if (counter) console.log(domOracle ? "PASS: V8 DOM counter oracle, identity/error/string witnesses and 10 input events" : "PASS: script-free native input counter, 10 events, one managed state object, resets on reload/navigation");
} finally {
  socket?.close();
  if (child.pid) {
    try { process.kill(-child.pid, "SIGTERM"); }
    catch (error) { if (errorCode(error) !== "ESRCH") throw error; }
  }
  launchLog.end();
}
