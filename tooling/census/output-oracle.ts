// The Node output of the exact materialized census project. Scripts share one
// realm; module cases retain their module goal and their fixture imports.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { flagsOf } from "./project.ts";
import { oracle } from "./suites/typescript.ts";

export type OutputOracle = { ok: true; output: string } | { ok: false; why: string };

export function outputOracle(project: string, scratch: string, body: string, tools,
  bounded: (command: string, args: string[]) => string[]): OutputOracle {
  if (tools.language === "ts") {
    let output = "";
    const admitted = oracle(body, scratch, printed => { output = printed; });
    return admitted.ok ? { ok: true, output } : admitted;
  }
  const marker = join(scratch, "output-oracle-terminal.json");
  const driver = join(scratch, "output-oracle.mjs");
  rmSync(marker, { force: true });
  writeFileSync(driver, `
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
const src = ${JSON.stringify(join(project, "src"))};
const marker = ${JSON.stringify(marker)};
const harness = join(src, "harness.ts");
try {
  vm.runInThisContext(stripTypeScriptTypes(readFileSync(harness, "utf8"), {mode:"transform"}), {filename:harness});
  for (const name of readdirSync(src).filter(name => name.startsWith("include-")).sort()) {
    const file = join(src, name);
    vm.runInThisContext(readFileSync(file, "utf8"), {filename:file});
  }
} catch (error) {
  writeFileSync(marker, JSON.stringify({complete:false, why:String(error)}));
  process.exit(2);
}
try {
  const main = join(src, "main.js");
  ${flagsOf(body).includes("module")
    ? 'await import(pathToFileURL(main).href);'
    : 'vm.runInThisContext(readFileSync(main, "utf8"), {filename:main});'}
  await new Promise(resolve => setImmediate(resolve));
  writeFileSync(marker, JSON.stringify({complete:true}));
} catch (error) {
  // A source throw is a complete Node observation. A process exit, signal,
  // timeout, or failed harness setup leaves no successful terminal marker.
  writeFileSync(marker, JSON.stringify({complete:true, thrown:String(error)}));
  process.exitCode = 1;
}
`);
  const run = spawnSync("sh", bounded(process.execPath, ["--no-warnings", driver]), {
    encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (run.error || run.signal || (run.status !== 0 && run.status !== 1)) {
    return { ok: false, why: `output oracle: ${run.error?.message ?? run.signal ?? `exit ${run.status}`}` };
  }
  try {
    const terminal = JSON.parse(readFileSync(marker, "utf8"));
    if (terminal.complete === true) return { ok: true, output: run.stdout ?? "" };
    return { ok: false, why: `output oracle setup: ${terminal.why}` };
  } catch {
    return { ok: false, why: "output oracle ended without its terminal observation" };
  }
}
