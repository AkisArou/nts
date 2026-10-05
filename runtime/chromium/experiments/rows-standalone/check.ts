#!/usr/bin/env node
/**
 * The rows workload without Chromium: the compiled application over a C
 * mini-DOM, and the V8 fixture's own page script over a JS mini-DOM in Node.
 * Both must build the same rows; the timings separate the application's own
 * cost (strings, arrays, RC, calls) from Blink's, which is not here at all.
 *
 *   node runtime/chromium/experiments/rows-standalone/check.ts [--perf]
 *
 * Run native-bootstrap/check.ts first: it compiles the program this links.
 * --perf records the C-backend binary with perf and prints its hottest
 * symbols. Two runtimes and two mini-DOMs differ, so the comparison bounds
 * the application cost; it is not a browser result.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const root = resolve(import.meta.dirname, "../../../..");
const here = import.meta.dirname;
const source = resolve(root, "third_party/chromium/src");
const clang = resolve(source, "third_party/llvm-build/Release+Asserts/bin/clang");
const sysroot = resolve(source, "build/linux/debian_bullseye_amd64-sysroot");
// Run native-bootstrap/check.ts with the same NTS_CHROMIUM_NATIVE_OUT to compare
// an experimental compiler without touching what Chromium stages.
const built = resolve(root, process.env.NTS_CHROMIUM_NATIVE_OUT ?? "target/chromium/native-bootstrap");
const output = `${built}-rows-standalone`;
const profile = process.argv.includes("--perf");
mkdirSync(output, { recursive: true });

interface Sample { case: string; round: number; batch: number; nsPerOperation: number; ntsAllocations?: number; idleCollectNs?: number }
interface Result { samples: Sample[]; finalRows: number; liveLeases?: number; leasesAfterDestroy?: number; maxRssKb?: number; liveBeforeApp?: number; liveAfterDestroy?: number; dom: string }

// Native: the archive the renderer links (program, runtime, shims; pinned
// clang -O2), with mini_dom.c standing in for the Blink adapter.
function native(backend: "c" | "llvm", policy: "checkpoint" | "idle"): Result {
  const generated = resolve(built, backend === "c" ? "probe" : "probe-llvm", "linux-gnu-x86_64");
  const executable = resolve(output, `rows-${backend}`);
  execFileSync(clang, [`--sysroot=${sysroot}`, "-std=c11", "-O2", "-g", "-ffunction-sections", "-fdata-sections",
    "-DNTS_PROVIDER_RC", "-D_GNU_SOURCE", "-fuse-ld=lld", "-I", generated,
    "-I", resolve(root, "runtime/chromium/experiments/native-bootstrap/native/ffi"),
    resolve(here, "driver.c"), resolve(here, "mini_dom.c"), resolve(built, `chromium-${backend}-probe.a`),
    "-Wl,--gc-sections", "-lm", "-o", executable], { stdio: "inherit" });
  if (profile && backend === "c" && policy === "checkpoint") {
    const data = resolve(output, "rows-c.perf.data");
    execFileSync("perf", ["record", "-q", "-g", "-o", data, executable, policy], { stdio: ["ignore", "ignore", "inherit"] });
    const report = execFileSync("perf", ["report", "-i", data, "--no-children", "--stdio", "--percent-limit", "1.5",
      "--sort", "symbol", "-g", "none"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    writeFileSync(resolve(output, "rows-c.perf.txt"), report);
    console.log(report.split("\n").filter(line => /^\s+\d/.test(line)).join("\n"));
  }
  return JSON.parse(execFileSync(executable, [policy], { encoding: "utf8", maxBuffer: 64 << 20 })) as Result;
}

// V8: the fixture page's script, unmodified, over a JS mini-DOM with the
// semantics mini_dom.c has. offsetHeight forces nothing here.
class MiniNode {
  parentNode: MiniNode | null = null;
  firstChild: MiniNode | null = null;
  lastChild: MiniNode | null = null;
  previousSibling: MiniNode | null = null;
  nextSibling: MiniNode | null = null;
  attributes = new Map<string, string>();
  listeners = new Map<string, () => unknown>();
  readonly tag: string;
  data: string | null;
  constructor(tag: string, data: string | null) {
    this.tag = tag;
    this.data = data;
  }
  get nodeValue(): string | null { return this.data; }
  set nodeValue(value: string) { this.data = value; }
  get offsetHeight(): number { return 0; }
  get className(): string { return this.attributes.get("class") ?? ""; }
  get textContent(): string {
    let text = this.data ?? "";
    for (let child = this.firstChild; child; child = child.nextSibling) text += child.textContent;
    return text;
  }
  set textContent(value: string) {
    while (this.firstChild) this.firstChild.remove();
    if (value) this.appendChild(new MiniNode("", value));
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  addEventListener(type: string, listener: () => unknown): void { this.listeners.set(type, listener); }
  appendChild(child: MiniNode): MiniNode { return this.insertBefore(child, null); }
  insertBefore(child: MiniNode, reference: MiniNode | null): MiniNode {
    child.remove();
    child.parentNode = this;
    child.nextSibling = reference;
    child.previousSibling = reference ? reference.previousSibling : this.lastChild;
    if (child.previousSibling) child.previousSibling.nextSibling = child; else this.firstChild = child;
    if (reference) reference.previousSibling = child; else this.lastChild = child;
    return child;
  }
  remove(): void {
    const parent = this.parentNode;
    if (!parent) return;
    if (this.previousSibling) this.previousSibling.nextSibling = this.nextSibling; else parent.firstChild = this.nextSibling;
    if (this.nextSibling) this.nextSibling.previousSibling = this.previousSibling; else parent.lastChild = this.previousSibling;
    this.parentNode = this.previousSibling = this.nextSibling = null;
  }
  cloneNode(deep: boolean): MiniNode {
    const copy = new MiniNode(this.tag, this.data);
    copy.attributes = new Map(this.attributes);
    if (deep) for (let child = this.firstChild; child; child = child.nextSibling) copy.appendChild(child.cloneNode(true));
    return copy;
  }
}
async function v8(): Promise<Result> {
  const html = readFileSync(resolve(root, "runtime/chromium/experiments/rows-benchmark-v8/index.html"), "utf8");
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert(script, "the V8 fixture has one inline script");
  const byId = new Map(["tbody", "benchmark-result", "v8-rows-run"].map(id => [`#${id}`, new MiniNode(id, null)]));
  const document = {
    createElement: (tag: string) => new MiniNode(tag, null),
    createTextNode: (text: string) => new MiniNode("", text),
    querySelector: (selector: string) => byId.get(selector) ?? null,
  };
  // The page posts each step as a task and waits a frame after setup; here a
  // frame is one more turn of the loop, since nothing renders.
  const requestAnimationFrame = (callback: () => void) => setImmediate(callback);
  runInNewContext(script, { document, performance, Error, JSON, MessageChannel, requestAnimationFrame });
  await byId.get("#v8-rows-run")!.listeners.get("input")!();
  const result = JSON.parse(byId.get("#benchmark-result")!.getAttribute("data-result")!) as Result;
  const rows: string[] = [];
  for (let row = byId.get("#tbody")!.firstChild; row; row = row.nextSibling) rows.push(`${row.className}|${row.textContent}`);
  result.dom = rows.join("\n");
  return result;
}

const results = { c: native("c", "checkpoint"), cIdle: native("c", "idle"), llvm: native("llvm", "checkpoint"),
  llvmIdle: native("llvm", "idle"), v8: await v8() };
for (const [name, result] of Object.entries(results)) {
  assert.equal(result.finalRows, 999, name);
  assert.equal(result.dom, results.v8.dom, `${name} must build the rows the page script builds`);
  if (name !== "v8") assert.equal(result.liveLeases, 2 + 2 * result.finalRows, `${name} leaked leases`);
  if (name !== "v8") assert.equal(result.leasesAfterDestroy, 0, `${name}: destroying the app and releasing the query left a lease`);
  if (name !== "v8") assert.equal(result.liveAfterDestroy, result.liveBeforeApp, `${name}: destroying the app left NTS objects alive`);
}
const median = (samples: Sample[]): number => {
  const values = samples.map(sample => sample.nsPerOperation).sort((a, b) => a - b);
  return values[Math.floor((values.length - 1) / 2)];
};
const table = [...new Set(results.v8.samples.map(sample => sample.case))].filter(name => !name.endsWith("+layout")).map(name => {
  const pick = (result: Result) => result.samples.filter(sample => sample.case === name);
  const [c, cIdle, llvmIdle, js] = [pick(results.c), pick(results.cIdle), pick(results.llvmIdle), pick(results.v8)];
  const us = (ns: number): number => +(ns / 1e3).toFixed(2);
  const collect = cIdle.map(sample => (sample.idleCollectNs ?? 0) / sample.batch).sort((a, b) => a - b);
  return {case: name, cCheckpointUs: us(median(c)), cIdleUs: us(median(cIdle)),
    idleCollectUsPerOp: us(collect[Math.floor((collect.length - 1) / 2)]), llvmIdleUs: us(median(llvmIdle)),
    v8Us: us(median(js)), cIdleOverV8: +(median(cIdle) / median(js)).toFixed(2),
    ntsAllocationsPerOperation: c[0].ntsAllocations === undefined ? undefined : +(c[0].ntsAllocations / c[0].batch).toFixed(1)};
});
writeFileSync(resolve(output, "result.json"), `${JSON.stringify({observedAt: new Date().toISOString(),
  scope: "Application cost over mini-DOMs: no Blink, no layout; two runtimes, two mini-DOM implementations",
  table, results: Object.fromEntries(Object.entries(results).map(([name, result]) => [name, {...result, dom: undefined}]))}, null, 2)}\n`);
console.table(table);
console.log(`Peak RSS: C checkpoint ${results.c.maxRssKb} KiB, C idle ${results.cIdle.maxRssKb} KiB (mini-DOM nodes are never freed in either)`);
console.log(`PASS: C and LLVM under both collection policies and the page script build the same ${results.v8.finalRows} rows; no leaked leases. Evidence: ${output}/result.json`);
