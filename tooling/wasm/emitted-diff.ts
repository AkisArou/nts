// Whether two compilers emit the same Wasm: every `tests/programs/` project and
// every benchmark case, emitted by each, compared byte for byte.
//
//   node tooling/wasm/emitted-diff.ts <before-nts> <after-nts> [name ...]
//        [--after-env KEY=VALUE ...] [--jobs N]
//
// A project counts as identical when both compilers emit it and the module and
// its glue are the same bytes; changed when both emit it differently; and as a
// failure of whichever side did not emit it at all. A failure is a number of
// its own, never folded into "identical": a refactor that makes the second
// compiler decline a project would otherwise read as one that changed nothing.
// `--after-env` sets an environment variable for the second compiler only,
// which is how one binary is compared with itself under a diagnostic switch
// (`NTS_WASM_STRING_UNIT_RECHECK=1`). Exit 1 when anything changed or failed
// on one side only, 2 when the instrument could not run.
//
// # The self-check, every run
//
// Before any project: one benchmark case emitted twice by the second compiler
// must hash alike (else every CHANGED below could be the emitter's own noise),
// and the same case with `NTS_WASM_STRING_UNIT_RECHECK=1` must hash
// differently (else "0 changed" could be a comparison that sees nothing).
// Either failing is exit 2.
//
// # Why
//
// A change meant to emit the same module -- a representation threaded through
// the emitter before it is used -- is proved by the bytes, not by tests that
// pass: a byte that moved is a change somebody has to account for.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const afterEnv: Record<string, string> = {};
let jobs = 4;
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--after-env") {
    const [key, ...value] = (args[++i] ?? "").split("=");
    if (!key || value.length === 0) fail(`--after-env needs KEY=VALUE`);
    afterEnv[key] = value.join("=");
  } else if (args[i] === "--jobs") {
    jobs = Number(args[++i]);
    if (!Number.isInteger(jobs) || jobs < 1) fail("--jobs needs a positive integer");
  } else {
    positional.push(args[i]);
  }
}
const [before, after, ...names] = positional;
if (!before || !after) fail("usage: node tooling/wasm/emitted-diff.ts <before-nts> <after-nts> [name ...] [--after-env KEY=VALUE] [--jobs N]");
for (const binary of [before, after]) if (!existsSync(binary)) fail(`no compiler at ${binary}`);

const SCRATCH = join(homedir(), ".cache/nts/emitted-diff", String(process.pid));
mkdirSync(SCRATCH, { recursive: true });
process.on("exit", () => rmSync(SCRATCH, { recursive: true, force: true }));
const tsgo = process.env.NTS_TSGO ?? join(ROOT, "target/tsgo");

function fail(why: string): never {
  console.error(`emitted-diff: ${why}`);
  process.exit(2);
}

type Project = { name: string; tsconfig: string };

/** A tsconfig for one benchmark case, as the bench compiles one: the fixtures' options. */
function benchProject(name: string, file: string): string {
  const dir = join(SCRATCH, "projects", name);
  mkdirSync(dir, { recursive: true });
  const tsconfig = join(dir, "tsconfig.json");
  writeFileSync(tsconfig, JSON.stringify({ extends: join(ROOT, "tsconfig.fixtures.json"), files: [file] }));
  return tsconfig;
}

function projects(): Project[] {
  const found: Project[] = [];
  for (const name of readdirSync(join(ROOT, "tests/programs")).sort()) {
    const tsconfig = join(ROOT, "tests/programs", name, "tsconfig.json");
    if (existsSync(tsconfig)) found.push({ name: `tests/programs/${name}`, tsconfig });
  }
  for (const name of readdirSync(join(ROOT, "benchmarks/cases")).sort()) {
    const file = join(ROOT, "benchmarks/cases", name, "case.ts");
    if (existsSync(file)) found.push({ name: `benchmarks/cases/${name}`, tsconfig: benchProject(name, file) });
  }
  return names.length ? found.filter((p) => names.some((n) => p.name === n || p.name.endsWith(`/${n}`))) : found;
}

/** The module and glue one compiler emits for a project, hashed, or why it emitted none. */
function emit(binary: string, env: Record<string, string>, project: Project, side: string): Promise<{ hash?: string; why?: string }> {
  const out = join(SCRATCH, side, project.name.replaceAll("/", "__"));
  return new Promise((done) => {
    const child = spawn(binary, ["emit-wasm", project.tsconfig, "--out", out], {
      env: { ...process.env, NTS_TSGO: tsgo, ...env },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      const files = ["program.wasm", "program.instance.mjs", "program.mjs"].map((f) => join(out, f));
      if (code !== 0 || !existsSync(files[0])) {
        done({ why: `exit ${code}: ${stderr.trim().split("\n").at(-1) ?? ""}`.slice(0, 200) });
        return;
      }
      const hash = createHash("sha256");
      for (const file of files) if (existsSync(file)) hash.update(readFileSync(file));
      rmSync(out, { recursive: true, force: true });
      done({ hash: hash.digest("hex") });
    });
  });
}

const all = projects();
if (all.length === 0) fail("no project selected");

{
  const probe: Project = {
    name: "self-check/strings",
    tsconfig: benchProject("self-check-strings", join(ROOT, "benchmarks/cases/strings/case.ts")),
  };
  const [first, second, rechecked] = await Promise.all([
    emit(after, afterEnv, probe, "self-a"),
    emit(after, afterEnv, probe, "self-b"),
    emit(after, { ...afterEnv, NTS_WASM_STRING_UNIT_RECHECK: "1" }, probe, "self-c"),
  ]);
  if (!first.hash || !second.hash || !rechecked.hash) fail(`self-check: the probe did not emit (${first.why ?? second.why ?? rechecked.why})`);
  if (first.hash !== second.hash) fail("self-check: one compiler emitted the same project two ways");
  if (first.hash === rechecked.hash) fail("self-check: a switch that changes the module read as identical");
  console.log("  self-check: one project emitted alike twice, and a known change seen");
}
const identical: string[] = [];
const changed: string[] = [];
const failedBefore: string[] = [];
const failedAfter: string[] = [];
const failedBoth: string[] = [];
let next = 0;
async function worker(): Promise<void> {
  while (next < all.length) {
    const project = all[next++];
    const [a, b] = await Promise.all([emit(before, {}, project, "before"), emit(after, afterEnv, project, "after")]);
    if (a.hash && b.hash) (a.hash === b.hash ? identical : changed).push(project.name);
    else if (!a.hash && !b.hash) failedBoth.push(project.name);
    else if (!a.hash) failedBefore.push(`${project.name}: ${a.why}`);
    else failedAfter.push(`${project.name}: ${b.why}`);
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, all.length) }, worker));

console.log(`  before ${before}`);
console.log(`  after  ${after}${Object.keys(afterEnv).length ? ` with ${Object.entries(afterEnv).map(([k, v]) => `${k}=${v}`).join(" ")}` : ""}`);
for (const name of changed) console.log(`  CHANGED       ${name}`);
for (const line of failedAfter) console.log(`  FAILED AFTER  ${line}`);
for (const line of failedBefore) console.log(`  FAILED BEFORE ${line}`);
console.log(`  ${all.length} project(s): ${identical.length} identical, ${changed.length} changed, ${failedAfter.length} failed after only, ${failedBefore.length} failed before only, ${failedBoth.length} emitted by neither`);
process.exit(changed.length || failedAfter.length || failedBefore.length ? 1 : 0);
