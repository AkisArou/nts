import {gitArguments} from "../gate/git-arguments/main.ts";
// Separate main-thread instruction counts for matched native task handlers.
// Run under with-lock.sh --wait; these counts do not supply bar wall times.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Duplex } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { openPage } from "./browser.ts";
import { sha256File } from "./hash.ts";
import { chromiumSource, chromiumState } from "./checkout.ts";
import { activeChromiumBuild } from "./profiles.ts";

const root = resolve(import.meta.dirname, "../..");
const [engine, destination, ...options] = process.argv.slice(2);
assert(engine && destination && (options.length === 0 || options.length === 2 && options[0] === "--runs"),
  "usage: kernel-count.ts <nts_shell> <output> [--runs 4]");
const runs = options.length ? Number(options[1]) : 4;
assert(Number.isSafeInteger(runs) && runs > 0 && runs % 2 === 0);
assert.equal(process.env.NTS_BENCH_CPUS, "4", "Run the count sitting under with-lock.sh --wait");
const output = resolve(destination), executable = resolve(engine);
const fixture = pathToFileURL(resolve(root, "runtime/chromium/benchmarks/pages/kernels/index.html")).href;
await mkdir(output, { recursive: true });
const commit = execFileSync("git", gitArguments(["-C", root, "rev-parse", "HEAD"]), { encoding: "utf8" }).trim();
assert.equal(execFileSync("git", gitArguments(["-C", root, "status", "--porcelain"]), { encoding: "utf8" }).trim(), "", "Count a committed clean tree");
assert.equal(activeChromiumBuild(root), undefined);
const argsText = await readFile(resolve(dirname(executable), "args.gn"), "utf8");
assert(!/is_debug\s*=\s*true/.test(argsText) && argsText.includes('nts_probe_backend = "c"'), "Use the optimized C probe");
const buildRecord = JSON.parse(await readFile(resolve(chromiumState(root), "perf/build-result.json"), "utf8"));
assert.equal(buildRecord.state, "passed");
assert.equal(buildRecord.executableSha256, sha256File(executable));
assert.equal(buildRecord.gnArgsSha256, sha256File(resolve(dirname(executable), "args.gn")));
const nativeManifestSha256 = sha256File(resolve(chromiumSource(root), "nts/manifest.json"));
assert.equal(buildRecord.nativeManifestSha256, nativeManifestSha256);
const compilerCheck = JSON.parse(await readFile(resolve(root, "target/chromium/native-bootstrap/check-result.json"), "utf8"));
const provenance = { observedAt: new Date().toISOString(), commit, executable, executableSha256: buildRecord.executableSha256,
  cpu: 4, argsText, buildRecord, nativeManifestSha256, compilerCheck };
const measurements = [];
for (let run = 0; run < runs; ++run) {
  const lanes = run % 2 ? ["compiled", "blink-intrinsic"] : ["blink-intrinsic", "compiled"];
  for (const lane of lanes) {
    const stem = `${run}-${lane}`;
    const args = ["--disable-features=SpareRendererForSitePerProcess", "--enable-logging=stderr",
      `--nts-probe-url=${fixture}`, `--nts-kernels-lane=${lane}`, "--nts-kernels-case=canvas-rects/task-call"];
    const page = await openPage(executable, fixture, { temporary: output, args, cpu: 4 });
    try {
      await page.until(() => page.evaluate("document.querySelector('#benchmark-result')?.getAttribute('data-state') === 'ready'"), "the selected kernel");
      const { rendererPid, affinities } = await page.pinForMeasurement();
      const status = await readFile(`/proc/${rendererPid}/status`, "utf8");
      assert(/^Seccomp:\s+2$/m.test(status) && /^NoNewPrivs:\s+1$/m.test(status));
      const point = await page.evaluate<{ x: number; y: number }>("(() => {const r=document.querySelector('#native-kernels-run').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
      const perfArgs = ["stat", "--no-big-num", "-x", ";", "--delay=-1", "--control=fd:3,4",
        "-e", "cpu_core/instructions/u,cpu_core/cycles/u", "-t", String(rendererPid), "-o", resolve(output, `${stem}.stat`)];
      const counter = spawn("perf", perfArgs, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
      let stderr = "", acknowledgementBuffer = "", acknowledgements = 0;
      counter.stderr!.on("data", bytes => { stderr += bytes.toString(); });
      (counter.stdio[4] as Duplex).on("data", bytes => {
        acknowledgementBuffer += bytes.toString().replaceAll("\0", "");
        const lines = acknowledgementBuffer.split("\n");
        acknowledgementBuffer = lines.pop()!;
        acknowledgements += lines.filter(line => line === "ack").length;
      });
      const closed = new Promise<number | null>((done, reject) => { counter.on("close", done); counter.on("error", reject); });
      const control = async (command: string) => {
        const expected = acknowledgements + 1;
        (counter.stdio[3] as Duplex).write(`${command}\n`);
        const deadline = performance.now() + 5000;
        while (acknowledgements < expected && counter.exitCode === null && performance.now() < deadline) await delay(5);
        assert.equal(counter.exitCode, null, stderr);
        assert.equal(acknowledgements, expected, `perf did not acknowledge ${command}: ${stderr}`);
      };
      await delay(100);
      assert.equal(counter.exitCode, null, stderr);
      await control("enable");
      for (const type of ["mousePressed", "mouseReleased"])
        await page.cdp("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
      // This observes the native completion log without polling V8 while
      // counters run. Result decoding and page close happen after disable.
      await page.until(() => /NTS_WORKLOAD done/.test(page.log()), "the counted native task handler");
      await control("disable");
      const result = JSON.parse(await page.evaluate<string>("document.querySelector('#benchmark-result').getAttribute('data-result')"));
      assert.equal(result.status, 0);
      assert.equal(result.auditOnly, false);
      assert.equal(result.executedIterations, 46000);
      assert.equal(result.samples.length, 20);
      assert(result.samples.every((s: { lane: string; shape: string; ntsAllocations: number }) => s.lane === lane && s.shape === "task-call" && s.ntsAllocations === 0));
      await page.close();
      assert.equal(await closed, 0, stderr);
      const stat = await readFile(resolve(output, `${stem}.stat`), "utf8");
      const event = (name: string) => {
        const rows = stat.split("\n").map(line => line.split(";").map(field => field.trim())).filter(fields => fields[2] === name);
        assert.equal(rows.length, 1, `${name}: ${stat}`);
        const value = Number(rows[0][0]);
        assert(Number.isFinite(value) && value > 0, stat);
        return value;
      };
      const instructions = event("cpu_core/instructions/u"), cycles = event("cpu_core/cycles/u");
      const measurement = { run, lane, instructions, cycles, tasks: result.executedIterations,
        instructionsPerTask: instructions / result.executedIterations, cyclesPerTask: cycles / result.executedIterations,
        unit: page.unit, cgroup: page.cgroup, rendererPid, affinities, status, args, perfArgs, stderr, result };
      measurements.push(measurement);
      await writeFile(resolve(output, `${stem}.json`), JSON.stringify(measurement, null, 2) + "\n");
      console.log(`${stem}: ${measurement.instructionsPerTask.toFixed(2)} instructions/task`);
    } finally {
      page.kill();
      await writeFile(resolve(output, `${stem}.log`), page.log());
    }
  }
}
await writeFile(resolve(output, "result.json"), JSON.stringify({ ...provenance, methodology: "Separate sandboxed main-thread launches, balanced lane order. Perf starts disabled, acknowledges enable before input and disable after the native completion log. No Runtime.evaluate polling while counters run. 46,000 MessageChannel tasks include 3 warm and 20 retained samples of 2,000 tasks. Counts include common launch/input/completion work within those boundaries; wall times come from the unprofiled sitting.", measurements }, null, 2) + "\n");
