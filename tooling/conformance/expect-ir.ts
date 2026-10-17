// The representation facts the corpora state, checked against the compiler.
//
//   node tooling/conformance/expect-ir.ts [name ...]
//   NTS_BIN=<a pinned copy> node tooling/conformance/expect-ir.ts
//
// A fact is a `// expect-ir: <backends>: <fact>` line in a fixture's or a
// benchmark's source (`nts expect-ir` has the form, in
// tooling/cli/src/expect_ir.rs). This finds every case that states one and
// runs `nts expect-ir` on it: a case under `tests/programs/` or
// `tests/refusals/` through its own tsconfig, a benchmark's `case.ts` through
// one made here the way the bench makes its own. A case fails when any of its
// facts does not hold, is unresolved, or does not parse.
//
// # Why its own step
//
// A representation decision is a performance decision. Benchmarks find a
// regression in one weeks later, under noise; a fact finds it in the landing
// that makes it, by name. `outcomes` and `examples` say what a program
// answers, and nothing in either says how it was represented.
//
// # The self-check
//
// Before any case, a fact known false is planted in a scratch case and must
// fail. A checker that passed everything would otherwise make this step green
// by construction; a failure here says the instrument is broken, not a case.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const NTS = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
const SCRATCH = join(homedir(), ".cache/nts/expect-ir", String(process.pid));
const FACT = "// expect-ir:";

if (!existsSync(NTS)) {
  console.log(`  NOT MEASURED: no compiler at ${NTS}; set NTS_BIN`);
  process.exit(2);
}
mkdirSync(SCRATCH, { recursive: true });
process.on("exit", () => rmSync(SCRATCH, { recursive: true, force: true }));

// `NTS_TSGO` from the caller when it names one, for the reason outcomes-check.ts
// gives: a pinned gate runs in a tree with no `target/` of its own.
const env = {
  ...process.env,
  NTS_NO_SNAPSHOT_CACHE: "1",
  NTS_TSGO: process.env.NTS_TSGO ?? join(ROOT, "target/tsgo"),
};

type Case = { name: string; tsconfig: string };

/** Whether a directory's TypeScript sources state a fact, searched without node_modules. */
function statesAFact(dir: string): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (statesAFact(path)) return true;
    } else if (/\.tsx?$/.test(entry.name) && readFileSync(path, "utf8").includes(FACT)) {
      return true;
    }
  }
  return false;
}

/** A tsconfig for one file, as the bench compiles a case: the fixtures' options. */
function projectFor(name: string, file: string): string {
  const dir = join(SCRATCH, name);
  mkdirSync(dir, { recursive: true });
  const tsconfig = join(dir, "tsconfig.json");
  writeFileSync(tsconfig, JSON.stringify({ extends: join(ROOT, "tsconfig.fixtures.json"), files: [file] }));
  return tsconfig;
}

function cases(): Case[] {
  const found: Case[] = [];
  for (const corpus of ["tests/programs", "tests/refusals"]) {
    for (const name of readdirSync(join(ROOT, corpus)).sort()) {
      const dir = join(ROOT, corpus, name);
      if (existsSync(join(dir, "tsconfig.json")) && statesAFact(dir)) {
        found.push({ name: `${corpus}/${name}`, tsconfig: join(dir, "tsconfig.json") });
      }
    }
  }
  const benchmarks = join(ROOT, "benchmarks/cases");
  for (const name of readdirSync(benchmarks).sort()) {
    const file = join(benchmarks, name, "case.ts");
    if (existsSync(file) && readFileSync(file, "utf8").includes(FACT)) {
      found.push({ name: `benchmarks/cases/${name}`, tsconfig: projectFor(`bench-${name}`, file) });
    }
  }
  return found;
}

function check(tsconfig: string): { ok: boolean; out: string } {
  const run = spawnSync(NTS, ["expect-ir", tsconfig], { encoding: "utf8", env, timeout: 300_000 });
  return { ok: run.status === 0, out: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

// --- the self-check ------------------------------------------------------------

{
  const dir = join(SCRATCH, "self-check");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "main.ts");
  writeFileSync(
    file,
    [
      "export function twice(x: number): number { return (x * 2) | 0; }",
      "// expect-ir: c: twice returns i32",
      "// expect-ir: c: twice returns f64",
      "",
    ].join("\n"),
  );
  const planted = check(projectFor("self-check-project", file));
  if (planted.ok || !planted.out.includes("PASS") || !planted.out.includes("FAIL")) {
    console.log("  SELF-CHECK FAILED: a case with one true and one planted false fact did not report both");
    console.log(planted.out.replace(/^/gm, "    "));
    process.exit(1);
  }
}

// --- the corpus ------------------------------------------------------------------

const named = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const selected = cases().filter((c) => named.length === 0 || named.some((n) => c.name.endsWith(n)));
if (selected.length === 0) {
  console.log(named.length ? `  no case states a fact among: ${named.join(", ")}` : "  no case states a fact");
  process.exit(named.length ? 1 : 0);
}

let failed = 0;
let facts = 0;
for (const c of selected) {
  const { ok, out } = check(c.tsconfig);
  const lines = out.split("\n");
  facts += lines.filter((line) => /^(PASS|FAIL|UNRESOLVED) /.test(line) && line.startsWith("PASS")).length;
  if (ok) {
    console.log(`  holds  ${c.name}`);
    continue;
  }
  failed += 1;
  console.log(`  FAILS  ${c.name}`);
  // Only what did not hold, and why: the passes are the noise here.
  for (const [at, line] of lines.entries()) {
    if (/^(FAIL|UNRESOLVED) /.test(line)) {
      console.log(`    ${line.replace(/\s+/, " ")}`);
      if (lines[at + 1]?.startsWith("            ")) console.log(`      ${lines[at + 1].trim()}`);
    } else if (/^Error: (?!.*expect-ir fact)/.test(line) || /: `.*` is not /.test(line)) {
      console.log(`    ${line}`);
    }
  }
}
console.log(`expect-ir: ${selected.length} case(s), ${facts} fact(s) hold, ${failed} case(s) fail`);
process.exit(failed === 0 ? 0 : 1);
