// Does what `emit-llvm` emits assemble?
//
//   node tooling/conformance/assembles.ts [project ...]   (default: runtime/node/*, runtime/web-platform)
//   NTS_BIN=<a pinned copy> node tooling/conformance/assembles.ts
//   node tooling/conformance/assembles.ts --rc      the counted IR, releases and all
//
// # Why
//
// The gate's `llvm` steps run the examples, and nothing ever emitted -- let
// alone assembled -- LLVM for the runtime modules. On 2026-09-27 a narrowed
// `unknown` read for its length emitted `getelementptr i8, ptr %v0` against
// `{ i32, i64 }`, the erased tagged pair: not IR. C has an arm for that
// operand and the JVM refuses it by name; only LLVM wrote something invalid,
// and at least `path`, `util` and `stream` could not be assembled with no
// instrument noticing. An artefact nothing consumes is an artefact nothing
// checks.
//
// # What it asks
//
// Per project, `nts emit-llvm` to a file, then `llvm-as <file> -o /dev/null`:
// a parse and the IR verifier, not a compile, a second or so per module. It
// stops at the first error, so this says *whether* a module assembles, with
// that error beside it -- not how many sites are wrong, which a static scan
// enumerates.
//
// Refusals are not failures: `emit-llvm` writes what it compiled and says
// what it declined, and what it wrote must still be valid IR. A module whose
// `emit-llvm` writes nothing, or dies, is NOT MEASURED.
//
// # Known modules
//
// `tooling/conformance/assembles.known`: `project<TAB>why`, one per line, for
// a module known not to assemble. Its failure prints and passes; any other
// fails. One that assembles again prints "remove it" and passes.
//
// Exit 0: every module assembles or is known not to. Exit 1: a new failure,
// or a module not measured. Exit 2: the tool could not start.

import { spawn } from "node:child_process";
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { frontendFor } from "./pin.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const KNOWN = join(HERE, "assembles.known");
const SOURCE = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
const LLVM_AS = process.env.NTS_LLVM_AS ?? "llvm-as";
// The frontend follows the pin (pin.ts `frontendFor`); none stops the run
// here, before every project prints nothing and reads as clean.
const FRONTEND = frontendFor(SOURCE, ROOT);
if (!FRONTEND.exists) {
  console.log(`  NOT MEASURED: no frontend at ${FRONTEND.path} -- set NTS_TSGO, or use a pin (it records its frontend)`);
  process.exit(2);
}
const env = { ...process.env, NTS_TSGO: FRONTEND.path };
const WORKERS = Number(process.env.NTS_ASSEMBLES_JOBS ?? 4);

if (!existsSync(SOURCE)) {
  console.log(`  NOT MEASURED: no compiler at ${SOURCE}; set NTS_BIN`);
  process.exit(2);
}
// IR for a runtime module is megabytes: under ~/.cache, never the /tmp tmpfs.
const base = join(homedir(), ".cache/nts-assembles");
mkdirSync(base, { recursive: true });
const scratch = mkdtempSync(join(base, "run-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));
// Pinned: a peer relinking target/release/nts mid-run must not change the
// compiler between two modules.
const NTS = join(scratch, "nts");
copyFileSync(SOURCE, NTS);
chmodSync(NTS, 0o755);

/**
 * Reference counting emits releases as IR too, and without `--rc` the provider
 * is no-gc and none are emitted: a counting change would assemble clean
 * whatever it did. `--rc` (or NTS_RC=1, as agree.mjs reads it) assembles the
 * counted IR; every run names its provider. 29 of 29 assembled under --rc
 * when this arrived (2026-09-28).
 */
const RC = process.argv.includes("--rc") || (process.env.NTS_RC ?? "0") !== "0";
const named = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const projects = (named.length > 0
  ? named
  : [
    ...readdirSync(join(ROOT, "runtime/node"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(ROOT, "runtime/node", e.name, "tsconfig.json")))
      .map((e) => `runtime/node/${e.name}`),
    "runtime/web-platform",
  ]).sort();

const known = new Map(
  (existsSync(KNOWN) ? readFileSync(KNOWN, "utf8") : "")
    .split("\n").filter((l) => l.trim() !== "" && !l.startsWith("#"))
    .map((l) => l.split("\t")).map(([p, why]) => [p, why ?? ""]),
);

const run = (cmd, args, stdoutTo) =>
  new Promise((done) => {
    const child = spawn(cmd, args, { cwd: ROOT, env, stdio: ["ignore", stdoutTo ?? "pipe", "pipe"] });
    let out = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 900_000);
    child.on("error", (error) => { clearTimeout(timer); done({ error, out }); });
    child.on("close", (status, signal) => { clearTimeout(timer); done({ status, signal, out }); });
  });

const failed = [];
const unmeasured = [];
let assembled = 0;
let bytes = 0;

async function check(project, slot) {
  const ir = join(scratch, `${slot}.ll`);
  const { openSync, closeSync } = await import("node:fs");
  const fd = openSync(ir, "w");
  const emit = await run(NTS, ["emit-llvm", project, ...(RC ? ["--rc"] : [])], fd);
  closeSync(fd);
  const size = statSync(ir).size;
  if (emit.error || emit.signal || size === 0) {
    unmeasured.push(`${project}: emit-llvm ${emit.signal ?? emit.error?.message ?? `exit ${emit.status}`} and wrote ${size} bytes -- ${emit.out.trim().split("\n").pop()?.slice(0, 100)}`);
    return;
  }
  bytes += size;
  const as = await run(LLVM_AS, [ir, "-o", "/dev/null"]);
  if (as.error) {
    unmeasured.push(`${project}: ${LLVM_AS} could not run: ${as.error.message}`);
    return;
  }
  if (as.status === 0) {
    assembled += 1;
    return;
  }
  // llvm-as prints `file:line:col: error: what`, then the line and a caret.
  const first = as.out.split("\n").find((l) => /error:/.test(l)) ?? as.out.trim().split("\n")[0];
  const line = as.out.split("\n")[as.out.split("\n").indexOf(first) + 1]?.trim() ?? "";
  failed.push({ project, error: first.replace(/^.*?\.ll:/, "").trim(), line });
}

const started = Date.now();
let next = 0;
await Promise.all(Array.from({ length: Math.min(WORKERS, projects.length) }, async (_, slot) => {
  while (next < projects.length) await check(projects[next++], slot);
}));

const fresh = failed.filter((f) => !known.has(f.project));
const held = failed.filter((f) => known.has(f.project));
const expired = [...known.keys()].filter((p) => projects.includes(p) && !failed.some((f) => f.project === p) && !unmeasured.some((u) => u.startsWith(`${p}:`)));
console.log(`  compiler ${SOURCE} (pinned), ${LLVM_AS}; provider ${RC ? "reference counting (--rc)" : "no-gc (releases are not emitted)"}`);
console.log(`  ${assembled} of ${projects.length} module(s) assemble, ${(bytes / 1e6).toFixed(1)} MB of IR, in ${Math.round((Date.now() - started) / 1000)} s`);
for (const f of fresh) console.log(`  DOES NOT ASSEMBLE  ${f.project}: ${f.error}\n                     ${f.line}`);
for (const f of held) console.log(`  known              ${f.project}: ${f.error} -- ${known.get(f.project)}`);
for (const p of expired) console.log(`  ^ ${p} assembles now: remove it from tooling/conformance/assembles.known`);
for (const u of unmeasured.sort()) console.log(`  NOT MEASURED       ${u}`);
const ok = fresh.length === 0 && unmeasured.length === 0 && assembled + held.length > 0;
console.log(ok ? `  every module assembles, or is known not to (${held.length})` : `  ${fresh.length} new failure(s), ${unmeasured.length} not measured`);
process.exit(ok ? 0 : 1);
