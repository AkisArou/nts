// Does the snapshot cache hit, and can a trip through it change anything?
//
//   node tooling/conformance/snapshot-cache.mjs [project ...]
//   NTS_BIN=<a pinned copy> node tooling/conformance/snapshot-cache.mjs
//
// # Why
//
// A cache that never hits produces correct output, so every other check
// passes over it. nts's snapshot cache has died that way twice. Its key once
// held a relative path, and the measured arms read 0.445 s against 0.442 s as
// "the cache is not worth much" rather than "it never hits". On 2026-09-27
// the digest of every program including runtime/web-platform differed
// between a cold build and a cached load: a map rebuilt by deserialisation
// re-hashed in a different order (05ecc8ed1). Apple found that one, and no
// gate step would have.
//
// # Per project, four arms of `nts frontend --decompose --calls` (the snapshot a
// # compilation asks for), then `emit-c` against them
//
//   off     NTS_NO_SNAPSHOT_CACHE=1 -- built, touching no cache: the reference
//   cold    a private, empty cache directory: builds and stores one entry
//   hit     the same directory: must load, rewriting no entry
//   hit     again
//
// 1. The four digests are one digest. A digest is a content digest, so a
//    store and a load cannot move it.
// 2. The loads hit, **counted by entry writes, never by timing**: after
//    `cold`, the directory's files, sizes and mtimes do not change. A timing
//    assertion on a half-second build is a flake, and "slower" is not "missed".
// 3. On the large programs, `emit-c` with the cache off and with the stored
//    entry is byte-identical, file by file.
// 4. A snapshot of another shape is not served to a compilation: after a bare
//    `nts frontend` stores its narrower snapshot, `emit-c` still compiles what
//    it compiles with the cache off. Until the key held the request's options
//    (decomposition, call resolution), it served that snapshot as a hit, and
//    `examples/math` compiled 16 functions of 40 -- through the default cache,
//    shared by every lane on the box. That is the direction that
//    matters: an unstable digest over an identical compilation is an
//    instrument lying, an identical digest over a different compilation is
//    not possible to see any other way. Small programs' maps do not collide,
//    so they cannot show a hash-order defect: this arm runs on the runtime
//    programs, and examples are the control for (1) and (2) only.
//
// **A bare `nts frontend` is the wrong instrument for a question about a
// build.** It asks for a narrower snapshot than any compilation does -- no
// call resolution, no decomposition -- so what it measures is a snapshot no
// compilation uses. This step's first digest arms used it and passed the
// hash-order defect on the binary that had it: a small snapshot's maps do not
// collide. Ask `frontend --decompose --calls`, the compilation's question.
//
// # Isolation
//
// Every arm uses a private cache directory, never the default under the temp
// directory, which every lane on the box shares: reading it measures whatever
// peers built, and clearing it slows them. The binary is copied first: an
// entry is stamped with the running executable's length and mtime, so a peer
// relinking `target/release/nts` mid-run would invalidate entries between
// arms and read as a miss.
//
// Exit 0: every project's digests agree, its loads hit, its C is identical.
// Exit 1: one of those failed, or a project was not measured. Exit 2: the tool
// could not start.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const SOURCE = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
const TSGO = process.env.NTS_TSGO ?? join(ROOT, "target/tsgo");
const WORKERS = Number(process.env.NTS_SNAPSHOT_CACHE_JOBS ?? 4);

if (!existsSync(SOURCE)) {
  console.log(`  NOT MEASURED: no compiler at ${SOURCE}; set NTS_BIN`);
  process.exit(2);
}
// Under ~/.cache, never /tmp: a tmpfs that fills. Removed on exit.
const scratchBase = join(homedir(), ".cache/nts-snapshot-cache-check");
mkdirSync(scratchBase, { recursive: true });
const scratch = mkdtempSync(join(scratchBase, "run-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));
const NTS = join(scratch, "nts");
copyFileSync(SOURCE, NTS);
chmodSync(NTS, 0o755);

const under = (base) =>
  readdirSync(join(ROOT, base), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, base, e.name, "tsconfig.json")))
    .map((e) => join(base, e.name));

/**
 * The population. Every runtime program whose sources include
 * runtime/web-platform -- where the hash-order defect lived -- plus
 * runtime/node/util, mid-sized with non-ASCII in five files; each of these
 * also compares its C. Then a fixed, spread sample of examples as the
 * control for the digest and the hit.
 */
const LARGE = [
  "assert", "child_process", "cluster", "console", "dgram", "events", "fs", "http",
  "net", "process", "readline", "stream", "util", "zlib",
].map((m) => `runtime/node/${m}`).concat("runtime/web-platform");
const named = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const examples = under("examples").sort();
const projects = named.length > 0
  ? named
  : [...LARGE, ...examples.filter((_, i) => i % 24 === 0)];
const comparesC = (p) => LARGE.includes(p) || named.includes(p);

/**
 * The environment for one arm. A variable an arm does not want is *removed*,
 * never emptied: the compiler asks whether `NTS_NO_SNAPSHOT_CACHE` is set and
 * not `0`, so an empty value disables the cache -- which is how this tool's
 * first run reported "the cold arm stored nothing" for every project.
 */
function armEnv(want) {
  const env = { ...process.env, NTS_TSGO: TSGO };
  delete env.NTS_NO_SNAPSHOT_CACHE;
  delete env.NTS_SNAPSHOT_CACHE;
  return { ...env, ...want };
}

const run = (args, want) =>
  new Promise((done) => {
    const child = spawn(NTS, args, { cwd: ROOT, env: armEnv(want) });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 900_000);
    child.on("close", (status, signal) => { clearTimeout(timer); done({ status, signal, out }); });
  });
const cacheOff = { NTS_NO_SNAPSHOT_CACHE: "1" };
const cacheAt = (dir) => ({ NTS_SNAPSHOT_CACHE: dir });

/** The directory's entries, as name/size/mtime -- what a rewrite changes. */
const entries = (dir) =>
  readdirSync(dir).sort().map((n) => { const s = statSync(join(dir, n)); return `${n} ${s.size} ${s.mtimeMs}`; }).join("\n");

/** Every file emit-c wrote, relative path -> sha256. */
function tree(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.set(relative(dir, p), createHash("sha256").update(readFileSync(p)).digest("hex"));
    }
  };
  walk(dir);
  return out;
}

const failures = [];
const unmeasured = [];
let measured = 0;
let comparedBytes = 0;

async function check(project, slot) {
  const dir = join(scratch, `cache-${slot}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const digestOf = async (env, arm) => {
    // The snapshot a compilation asks for (`for_compilation`: calls resolved
    // and decomposed), not bare `frontend`'s narrower one -- a small snapshot's
    // maps do not collide, so digesting it cannot see a hash-order defect.
    const r = await run(["frontend", project, "--decompose", "--calls"], env);
    const d = /^snapshot digest\s+(\S+)/m.exec(r.out)?.[1];
    if (!d) unmeasured.push(`${project}: \`frontend\` (${arm}) printed no digest: ${r.signal ?? `exit ${r.status}`} ${r.out.trim().split("\n").pop()?.slice(0, 80)}`);
    return d;
  };
  const off = await digestOf(cacheOff, "cache off");
  const cold = await digestOf(cacheAt(dir), "cold");
  if (!off || !cold) return;
  const stored = entries(dir);
  if (stored === "") {
    failures.push(`${project}: the cold arm stored nothing -- no entry to hit`);
    return;
  }
  const hit1 = await digestOf(cacheAt(dir), "hit");
  const after1 = entries(dir);
  const hit2 = await digestOf(cacheAt(dir), "hit again");
  const after2 = entries(dir);
  if (!hit1 || !hit2) return;
  const digests = [off, cold, hit1, hit2];
  if (new Set(digests).size > 1) failures.push(`${project}: digest moved -- off ${off}, cold ${cold}, hit ${hit1}, hit ${hit2}`);
  if (after1 !== stored || after2 !== stored) failures.push(`${project}: a load rewrote its entry -- the cache missed`);

  if (comparesC(project)) {
    const coldC = join(scratch, `c-off-${slot}`);
    const hitC = join(scratch, `c-hit-${slot}`);
    rmSync(coldC, { recursive: true, force: true });
    rmSync(hitC, { recursive: true, force: true });
    const a = await run(["emit-c", project, "--out", coldC], cacheOff);
    const b = await run(["emit-c", project, "--out", hitC], cacheAt(dir));
    if (entries(dir) !== stored) failures.push(`${project}: \`emit-c\` rewrote the entry -- it missed where \`frontend\` hit`);
    if (a.signal || b.signal || !existsSync(coldC) || !existsSync(hitC)) {
      unmeasured.push(`${project}: \`emit-c\` wrote nothing to compare (${a.signal ?? a.status} / ${b.signal ?? b.status})`);
      return;
    }
    const [x, y] = [tree(coldC), tree(hitC)];
    const differs = (p, q) => [...new Set([...p.keys(), ...q.keys()])].filter((f) => p.get(f) !== q.get(f));
    const differ = differs(x, y);
    if (differ.length > 0) failures.push(`${project}: \`emit-c\` from a stored entry differs from cache-off in ${differ.length} file(s) (${differ.slice(0, 3).join(", ")}) -- the cache changes the compilation`);

    // (4) A snapshot of another shape must not be served to a compilation.
    // Bare `frontend` asks for less than `emit-c` does, and until the key held
    // the request's options it stored under the same entry: `emit-c` loaded
    // it as a hit and compiled 16 functions of `examples/math`'s 40.
    const narrow = join(scratch, `cache-narrow-${slot}`);
    const narrowC = join(scratch, `c-narrow-${slot}`);
    rmSync(narrow, { recursive: true, force: true });
    rmSync(narrowC, { recursive: true, force: true });
    mkdirSync(narrow, { recursive: true });
    await run(["frontend", project], cacheAt(narrow));
    await run(["emit-c", project, "--out", narrowC], cacheAt(narrow));
    const served = existsSync(narrowC) ? differs(x, tree(narrowC)) : null;
    if (served === null) unmeasured.push(`${project}: \`emit-c\` after a bare \`frontend\` wrote nothing`);
    else if (served.length > 0) failures.push(`${project}: after a bare \`frontend\` stored its entry, \`emit-c\` compiled differently in ${served.length} file(s) (${served.slice(0, 3).join(", ")}) -- a narrower snapshot served under the same key`);
    rmSync(narrow, { recursive: true, force: true });
    rmSync(narrowC, { recursive: true, force: true });
    if (x.size === 0) unmeasured.push(`${project}: \`emit-c\` wrote no file, so identical means nothing`);
    for (const f of x.keys()) comparedBytes += statSync(join(coldC, f)).size;
    rmSync(coldC, { recursive: true, force: true });
    rmSync(hitC, { recursive: true, force: true });
  }
  measured += 1;
}

const started = Date.now();
let next = 0;
await Promise.all(Array.from({ length: Math.min(WORKERS, projects.length) }, async (_, slot) => {
  while (next < projects.length) await check(projects[next++], slot);
}));

console.log(`  compiler ${SOURCE} (pinned for the run)`);
console.log(`  ${measured} of ${projects.length} project(s) measured in ${Math.round((Date.now() - started) / 1000)} s; ` +
  `C compared on ${projects.filter(comparesC).length}, ${(comparedBytes / 1e6).toFixed(1)} MB`);
for (const f of failures.sort()) console.log(`  FAILED        ${f}`);
for (const u of unmeasured.sort()) console.log(`  NOT MEASURED  ${u}`);
const ok = failures.length === 0 && unmeasured.length === 0 && measured > 0;
console.log(ok ? "  every digest stable across the cache, every load a hit, the C identical" : `  ${failures.length} failure(s), ${unmeasured.length} not measured`);
process.exit(ok ? 0 : 1);
