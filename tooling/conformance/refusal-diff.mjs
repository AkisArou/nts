// What happened to each function between two compilers: compiled, refused,
// both, or absent -- and which way it moved.
//
//   node tooling/conformance/refusal-diff.mjs <before> <after> [project ...]
//                                         (default: runtime/node/*, runtime/web-platform)
//   node tooling/conformance/refusal-diff.mjs --self-test
//
// # Why
//
// A refusal count cannot tell a function that stopped compiling from one that
// stopped being silent. On 2026-09-27 a narrowing change read +2 refusals and
// +14 definitions over the runtime, and the nine new occurrences were one
// function, `stringChunkAt`, which was absent from the emitted program in
// *both* arms and named in neither's refusals before. It had not stopped
// compiling. It had started saying why it never did. The count read that as
// a loss.
//
// So each function name is placed in one of four states per compiler, from
// `hir --prepared` (what the backend receives) and `nts refusals`:
//
//   compiled   defined by the prepared program, not refused
//   refused    refused, not defined
//   phantom    both -- a refusal naming what compiles (integrity's
//              refusal-not-compiled)
//   absent     neither: a function nothing lowered and nothing names
//
// and every name whose state moved is printed under what the move means:
//
//   compiled -> refused   STOPPED COMPILING, with a named reason: a loss
//   compiled -> absent    DROPPED SILENTLY: a loss nothing reports -- the worst
//   refused  -> absent    ROOT LOST: a refusal disappeared and the function
//                         did not come back
//   absent   -> refused   NEWLY NAMED: a silent absence gained a root
//   * -> compiled         NEWLY COMPILES: reach, which is also what an unsound
//                         change looks like -- read each one
//   phantom in either     a refusal record lying, appearing or clearing
//
// Only names either compiler knows are compared: a function neither lowered
// nor named is invisible to both, and not counted as absent-to-absent.
//
// # Names are compared with the compiler's numbering taken out
//
// A generic instance's type id (`R<3054>`), a closure's number and an
// `objN` suffix move between two builds of unrelated code, so a raw name set
// reports churn that is renumbering. A name is compiled if any of its
// instances is. The cost is that an instance that compiled beside one that
// refused reads as compiled; the refusal count per module is printed beside
// the states so that is visible.
//
// Exit 0 when nothing moved to a loss (compiled -> refused/absent, refused ->
// absent); exit 1 otherwise; exit 2 when it could not run. Moves the other way
// print and pass: a person reads each one.

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const env = { ...process.env, NTS_TSGO: process.env.NTS_TSGO ?? join(ROOT, "target/tsgo") };
const WORKERS = Number(process.env.NTS_REFUSAL_DIFF_JOBS ?? 4);

/** A name with the compiler's numbering taken out. */
export const stable = (name) => name.replace(/<\d+>/g, "<N>").replace(/Closure\d+/g, "ClosureN").replace(/obj\d+/g, "objN");

/** name -> "compiled" | "refused" | "phantom", from one compiler's two listings. */
export function states(prepared, refusals) {
  const compiled = new Set();
  for (const m of prepared.matchAll(/^(?:export )?func (.+?)\(/gm)) compiled.add(stable(m[1]));
  const refused = new Set(refusals.split("\n").map((l) => l.split("\t")[0]).filter(Boolean).map(stable));
  const out = new Map();
  for (const n of compiled) out.set(n, refused.has(n) ? "phantom" : "compiled");
  for (const n of refused) if (!compiled.has(n)) out.set(n, "refused");
  return out;
}

/** Every name whose state moved, each under the kind of move it is. */
export function moves(before, after) {
  const kinds = new Map();
  const add = (kind, name, from, to) => kinds.set(kind, [...(kinds.get(kind) ?? []), { name, from, to }]);
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const from = before.get(name) ?? "absent";
    const to = after.get(name) ?? "absent";
    if (from === to) continue;
    if (to === "phantom" || from === "phantom") add(to === "phantom" ? "PHANTOM APPEARED" : "phantom cleared", name, from, to);
    else if (from === "compiled" && to === "refused") add("STOPPED COMPILING", name, from, to);
    else if (from === "compiled" && to === "absent") add("DROPPED SILENTLY", name, from, to);
    else if (from === "refused" && to === "absent") add("ROOT LOST", name, from, to);
    else if (from === "absent" && to === "refused") add("newly named", name, from, to);
    else if (to === "compiled") add("newly compiles", name, from, to);
  }
  return kinds;
}
const LOSSES = new Set(["STOPPED COMPILING", "DROPPED SILENTLY", "ROOT LOST", "PHANTOM APPEARED"]);

// **Seen to classify every move before it is trusted.**
function selfTest() {
  const before = states(
    "func kept(x: f64) -> f64 {\nfunc goesQuiet(x: f64) -> f64 {\nfunc starts(x: f64) -> f64 {\nfunc R<3054>#m(this: managed<obj#1>) -> f64 {\nfunc lying(x: f64) -> f64 {\n",
    "stringChunkAt\tsomething\nforgotten\tsomething\nstarts2\tx\nlying\tx\n",
  );
  const after = states(
    "func kept(x: f64) -> f64 {\nfunc R<9999>#m(this: managed<obj#1>) -> f64 {\nfunc starts2(x: f64) -> f64 {\nfunc lying(x: f64) -> f64 {\n",
    "stringChunkAt\tsomething\nstarts\tnow a reason\nnewRoot\tfinally named\nlying\tx\n",
  );
  const m = moves(before, after);
  const names = (k) => (m.get(k) ?? []).map((x) => x.name).sort().join(",");
  if (names("STOPPED COMPILING") !== "starts") return `stopped compiling: ${names("STOPPED COMPILING")}`;
  if (names("DROPPED SILENTLY") !== "goesQuiet") return `dropped silently: ${names("DROPPED SILENTLY")}`;
  if (names("ROOT LOST") !== "forgotten") return `root lost: ${names("ROOT LOST")}`;
  if (names("newly named") !== "newRoot") return `newly named: ${names("newly named")}`;
  if (names("newly compiles") !== "starts2") return `newly compiles: ${names("newly compiles")}`;
  if (m.has("phantom cleared") || m.has("PHANTOM APPEARED")) return "a phantom present in both arms read as a move";
  if ([...m.values()].flat().some((x) => x.name.startsWith("R<"))) return "a renumbered generic instance read as a move";
  return null;
}
const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (process.argv.includes("--self-test")) {
  console.log("  self-test: every move classified; a renumbered instance and a standing phantom are not moves");
  process.exit(0);
}

const [beforeBin, afterBin, ...named] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!beforeBin || !afterBin || !existsSync(beforeBin) || !existsSync(afterBin)) {
  console.log("  usage: refusal-diff.mjs <before-nts> <after-nts> [project ...]  (both binaries must exist)");
  process.exit(2);
}
const projects = named.length > 0 ? named : [
  ...readdirSync(join(ROOT, "runtime/node"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, "runtime/node", e.name, "tsconfig.json")))
    .map((e) => `runtime/node/${e.name}`),
  "runtime/web-platform",
].sort();

const run = (bin, args) => new Promise((done) => {
  const c = spawn(bin, args, { cwd: ROOT, env });
  let stdout = "";
  let stderr = "";
  c.stdout.on("data", (d) => (stdout += d));
  c.stderr.on("data", (d) => (stderr += d));
  c.on("close", (status, signal) => done({ status, signal, stdout, stderr }));
});

const results = [];
const unmeasured = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(WORKERS, projects.length) }, async () => {
  while (next < projects.length) {
    const project = projects[next++];
    const arms = [];
    for (const bin of [beforeBin, afterBin]) {
      const [hir, ref] = await Promise.all([run(bin, ["hir", "--prepared", project]), run(bin, ["refusals", project])]);
      const listing = `${hir.stdout}${hir.stderr}`;
      if (hir.signal || ref.signal || !/^\d+ function\(s\)/m.test(listing)) {
        unmeasured.push(`${project}: ${bin} printed no prepared listing`);
        arms.push(null);
        continue;
      }
      arms.push({ states: states(hir.stdout, ref.stdout), refusals: ref.stdout.split("\n").filter(Boolean).length });
    }
    if (arms.every(Boolean)) results.push({ project, moved: moves(arms[0].states, arms[1].states), refusals: [arms[0].refusals, arms[1].refusals] });
  }
}));

console.log(`  before ${beforeBin}\n  after  ${afterBin}`);
let losses = 0;
for (const { project, moved, refusals } of results.sort((a, b) => a.project.localeCompare(b.project))) {
  if (moved.size === 0 && refusals[0] === refusals[1]) continue;
  console.log(`  ${project}: refusal rows ${refusals[0]} -> ${refusals[1]}`);
  for (const [kind, list] of [...moved].sort(([a], [b]) => a.localeCompare(b))) {
    if (LOSSES.has(kind)) losses += list.length;
    console.log(`    ${kind.padEnd(18)} ${list.length}: ${list.slice(0, 6).map((x) => x.name).join(", ")}${list.length > 6 ? ", ..." : ""}`);
  }
}
for (const u of unmeasured) console.log(`  NOT MEASURED  ${u}`);
console.log(`  ${results.length} of ${projects.length} project(s) compared; ${losses} move(s) to a loss`);
process.exit(unmeasured.length > 0 ? 2 : losses > 0 ? 1 : 0);
