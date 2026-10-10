// Compile the generated C for every runtime project, including web-platform.
//
//   NTS_BIN=<pin> node tooling/conformance/c-compiles.mjs [project ...]
//
// The addon floor covers runtime/node only. HIR, byte-identical snapshot-cache
// output and valid LLVM did not catch web-platform's undeclared descriptors.
// This checks program.c itself with clang -std=c11 -fsyntax-only, without
// requiring Node headers or linking each project's native provider.
//
// Reuse profile's --napi emission only when its compiler hash and module exit
// status match. Standalone, emit into a private directory. Refusals may leave
// compiled bodies, but a failed or empty emission is NOT MEASURED, never a pass.
// Exit 0: every project compiles. 1: rejection or not measured. 2: setup failed.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync,
  readFileSync, rmSync, statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { frontendFor } from "./pin.ts";
import { longestFirst, recordCosts } from "../gate/costs.mjs";
import { withToken } from "../gate/tokens.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const FLAGS = ["-std=c11", "-fsyntax-only"];

function run(command, args, root, env) {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (data) => { out += data; });
    child.stderr.on("data", (data) => { out += data; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
    child.on("error", (error) => { clearTimeout(timer); done({ error, out }); });
    child.on("close", (status, signal) => { clearTimeout(timer); done({ status, signal, out }); });
  });
}

function size(path) {
  try { return statSync(path).size; } catch { return 0; }
}

function read(path) {
  try { return readFileSync(path, "utf8").trim(); } catch { return ""; }
}

export function cachedEmission(project, base, hash) {
  if (!base || !project.startsWith("runtime/node/") || read(join(base, ".emitted-by")) !== hash) return null;
  const name = project.slice("runtime/node/".length);
  return read(join(base, `${name}.status`)) === "0" ? join(base, name) : null;
}

export async function measure({ project, root, compiler, env, work, cached, cc }) {
  const out = cached ?? work;
  if (!cached) {
    mkdirSync(out, { recursive: true });
    const emit = await run(compiler, ["emit-c", project, "--out", out, "--napi"], root, env);
    if (emit.error || emit.signal || emit.status !== 0) {
      return { category: "not-measured", why: `emit-c ${emit.signal ?? emit.error?.message ?? `exit ${emit.status}`}: ${emit.out.trim().split("\n").pop()}` };
    }
  }
  const source = join(out, "program.c");
  const bytes = size(source);
  if (bytes === 0) return { category: "not-measured", why: "emit-c wrote no nonempty program.c" };
  const compiled = await run(cc, [...FLAGS, "-I", out, source], root, env);
  if (compiled.error || compiled.signal) {
    return { category: "not-measured", why: `${cc}: ${compiled.signal ?? compiled.error.message}` };
  }
  if (compiled.status !== 0) {
    const first = compiled.out.split("\n").find((line) => /error:/.test(line)) ?? compiled.out.trim().split("\n")[0];
    return { category: "rejected", why: first.replaceAll(out, "<emitted>") };
  }
  return { category: "compiles", bytes, reused: Boolean(cached) };
}

async function main() {
  const source = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
  const cc = process.env.NTS_C_COMPILES_CC ?? "clang";
  const frontend = frontendFor(source, ROOT);
  if (!existsSync(source) || !frontend.exists) {
    console.log(`  NOT MEASURED: compiler ${source}; frontend ${frontend.path} -- both are required`);
    return 2;
  }
  const env = { ...process.env, NTS_TSGO: frontend.path };
  const named = process.argv.slice(2);
  const nodeProjects = readdirSync(join(ROOT, "runtime/node"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(ROOT, "runtime/node", entry.name, "tsconfig.json")))
    .map((entry) => `runtime/node/${entry.name}`);
  const projects = named.length > 0 ? named : [...nodeProjects, "runtime/web-platform"];
  if (named.length === 0 && (nodeProjects.length === 0 || !existsSync(join(ROOT, "runtime/web-platform/tsconfig.json")))) {
    console.log("  NOT MEASURED: the runtime corpus is incomplete");
    return 2;
  }
  const base = join(process.env.TMPDIR ?? join(ROOT, "target"), "nts-c-compiles");
  mkdirSync(base, { recursive: true });
  const scratch = mkdtempSync(join(base, "run-"));
  process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));
  const compiler = join(scratch, "nts");
  copyFileSync(source, compiler);
  chmodSync(compiler, 0o755);
  const hash = createHash("sha256").update(readFileSync(compiler)).digest("hex");
  const cached = process.env.NTS_ADDON_EMITTED;
  const queue = longestFirst("c-compiles", projects);
  const timed = {};
  const results = new Map();
  let next = 0;
  const workers = Number(process.env.NTS_C_COMPILES_JOBS ?? process.env.NTS_GATE_JOBS ?? 4);
  if (!Number.isInteger(workers) || workers < 1) throw new Error("NTS_C_COMPILES_JOBS must be a positive integer");
  const started = Date.now();
  await Promise.all(Array.from({ length: Math.min(workers, queue.length) }, async () => {
    while (next < queue.length) {
      const index = next++;
      const project = queue[index];
      const began = Date.now();
      const result = await withToken(() => measure({
        project, root: ROOT, compiler, env, cc,
        work: join(scratch, String(index)), cached: cachedEmission(project, cached, hash),
      }));
      results.set(project, result);
      timed[project] = (Date.now() - began) / 1000;
    }
  }));
  recordCosts("c-compiles", timed);
  const compiled = [...results.values()].filter((result) => result.category === "compiles");
  console.log(`  compiler ${source} (sha256:${hash.slice(0, 16)}), ${cc} ${FLAGS.join(" ")}`);
  console.log(`  ${compiled.length} of ${projects.length} project(s) compile, ${(compiled.reduce((total, result) => total + result.bytes, 0) / 1e6).toFixed(1)} MB of C, ${compiled.filter((result) => result.reused).length} reused emissions, in ${Math.round((Date.now() - started) / 1000)} s`);
  for (const [project, result] of [...results].sort()) {
    if (result.category !== "compiles") console.log(`  ${result.category === "rejected" ? "DOES NOT COMPILE" : "NOT MEASURED"}  ${project}: ${result.why}`);
  }
  return compiled.length === projects.length ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(`  NOT MEASURED: ${error.message}`); process.exitCode = 2; }
}
