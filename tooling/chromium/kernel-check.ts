// Exercise the actual audit and selected timed paths before a quiet sitting.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openPage } from "./browser.ts";

const root = resolve(import.meta.dirname, "../..");
const executable = resolve(process.argv[2]), output = resolve(process.argv[3]);
const fixture = pathToFileURL(resolve(root, "runtime/chromium/benchmarks/pages/kernels/index.html")).href;
await mkdir(output, { recursive: true });
for (const mode of ["audit", "blink-intrinsic", "compiled"]) {
  const selected = mode === "audit" ? ["--nts-kernels-audit-calls"]
    : [`--nts-kernels-lane=${mode}`, "--nts-kernels-case=canvas-rects/task-call"];
  const page = await openPage(executable, fixture, { temporary: output,
    args: ["--disable-features=SpareRendererForSitePerProcess", "--enable-logging=stderr", `--nts-probe-url=${fixture}`, ...selected] });
  try {
    await page.until(() => page.evaluate("document.querySelector('#benchmark-result')?.getAttribute('data-state') === 'ready'"), "the native kernel launch");
    const point = await page.evaluate<{ x: number; y: number }>("(() => {const r=document.querySelector('#native-kernels-run').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    for (const type of ["mousePressed", "mouseReleased"])
      await page.cdp("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
    await page.until(() => /NTS_WORKLOAD done/.test(page.log()), "the native kernel result");
    const result = JSON.parse(await page.evaluate<string>("document.querySelector('#benchmark-result').getAttribute('data-result')"));
    assert.equal(result.status, 0);
    assert.equal(result.liveRoots, 0);
    if (mode === "audit") {
      assert.equal(result.auditOnly, true);
      assert.equal(result.samples.length, 0);
      assert.equal(result.audits.length, 11);
      for (const row of result.audits) assert.equal(row.checksum, row.iterations);
    } else {
      assert.equal(result.auditOnly, false);
      assert.equal(result.samples.length, 20);
      assert.equal(result.executedIterations, 46000);
      assert(result.samples.every((sample: { lane: string; kernel: string; shape: string; ntsAllocations: number }) =>
        sample.lane === mode && sample.kernel === "canvas-rects" && sample.shape === "task-call" && sample.ntsAllocations === 0));
    }
    await writeFile(resolve(output, `${mode}.json`), JSON.stringify(result, null, 2) + "\n");
    await page.close();
    console.log(`PASS: kernel ${mode}; call counts/checksums and timed-window counting guards`);
  } finally {
    page.kill();
    await writeFile(resolve(output, `${mode}.log`), page.log());
  }
}
