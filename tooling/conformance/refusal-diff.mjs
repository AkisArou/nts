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
//   refused  -> absent    ROOT LOST when an after-arm refusal still cites it
//                         as a callee: it is wanted and nothing explains it.
//                         Otherwise "dropped, nothing wants it" (a note): dead
//                         code, unreachable once its cascade cleared
//   absent   -> refused   NEWLY NAMED: a silent absence gained a root
//   * -> compiled         NEWLY COMPILES: reach, which is also what an unsound
//                         change looks like -- read each one
//   phantom in either     a refusal record lying, appearing or clearing
//
// Only names either compiler knows are compared: a function neither lowered
// nor named is invisible to both, and not counted as absent-to-absent.
//
// **"compiled" means the prepared program defines it, not that the backend
// emitted it.** A function the backend then declines (NTS2009, emit-c's
// `drop_orphaned_bodies`) reads as compiled here; no emitted C is read. So
// `absent` is "nothing lowered it far enough to be defined or named", and a
// function lowered and then dropped by the backend is a blind spot of this
// tool, with the same footprint in `program.c`. `assembles` and the backend's
// own NTS2009 lines are where that half is seen.
//
// **"0 moves" does not mean "no effect".** This sees which functions compile,
// never which *answer* a compiled function gives. 7f7bf5340 stopped folding
// `Array.isArray` on a value narrowed to `object` to `false`, and this read 27
// of 27 projects unmoved, with the census and the definitions floor unchanged
// too, while the emitted C differed in all 26 node modules and two live
// wrong answers in the runtime were fixed (`validateObject` accepted an array;
// `ERR_INVALID_ARG_TYPE` never named one "Array"). A change that alters answers
// is measured by `agree` and by comparing emitted code, not here.
//
// **A newly named function is often an older gap becoming askable.** When a
// change clears one refusal, lowering reaches further, and the root that
// arrives can be an unrelated, standing gap: `stringChunkAt`'s narrowing
// began to land, so `chunk.toString()` resolved to `Buffer#toString`, whose
// default reads `Buffer`'s layout -- and `Buffer extends Uint8Array`, a base
// with no representation. Read those neither as regressions nor as noise:
// they are the next question, now reachable.
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
import { armLines, frontendFor, oneChange } from "./pin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const WORKERS = Number(process.env.NTS_REFUSAL_DIFF_JOBS ?? 4);

/** A name with the compiler's numbering taken out. */
export const stable = (name) => name.replace(/<\d+>/g, "<N>").replace(/Closure\d+/g, "ClosureN").replace(/obj\d+/g, "objN");

/**
 * `{ states, wanted }` from one compiler's two listings: each name's state
 * ("compiled" | "refused" | "phantom"), and the names some refusal still
 * cites as a callee ("it calls `X`").
 */
export function states(prepared, refusals) {
  const compiled = new Set();
  for (const m of prepared.matchAll(/^(?:export )?func (.+?)\(/gm)) compiled.add(stable(m[1]));
  const reasons = new Map();
  for (const line of refusals.split("\n")) {
    const [name, reason] = line.split("\t");
    if (name) reasons.set(stable(name), reason ?? "");
  }
  const out = new Map();
  for (const n of compiled) out.set(n, reasons.has(n) ? "phantom" : "compiled");
  for (const n of reasons.keys()) if (!compiled.has(n)) out.set(n, "refused");
  const wanted = new Set();
  for (const reason of reasons.values()) for (const m of reason.matchAll(/it calls `([^`]+)`/g)) wanted.add(stable(m[1]));
  return { states: out, wanted };
}

/**
 * Every name whose state moved, each under the kind of move it is.
 *
 * refused -> absent is a loss iff something still wants the function: an
 * after-arm refusal cites it as a callee ("it calls `X`"). A compiled function
 * cannot call an absent one (`verify` rejects a missing callee), so a cascade
 * is the only way an absent function can still be wanted. Otherwise it is
 * dead code, dropped by `drop_orphaned_bodies` once nothing reaches it:
 * `patternMatches`, whose only caller stayed refused while its own cascade
 * cleared, read as seven losses. A first version matched the cause's *text*
 * per project and still read them as losses, because the same sentence is
 * written by many sites.
 */
export function moves(beforeArm, afterArm) {
  const before = beforeArm.states;
  const after = afterArm.states;
  const kinds = new Map();
  const add = (kind, name, from, to) => kinds.set(kind, [...(kinds.get(kind) ?? []), { name, from, to }]);
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const from = before.get(name) ?? "absent";
    const to = after.get(name) ?? "absent";
    if (from === to) continue;
    if (to === "phantom" || from === "phantom") add(to === "phantom" ? "PHANTOM APPEARED" : "phantom cleared", name, from, to);
    else if (from === "compiled" && to === "refused") add("STOPPED COMPILING", name, from, to);
    else if (from === "compiled" && to === "absent") add("DROPPED SILENTLY", name, from, to);
    else if (from === "refused" && to === "absent") add(afterArm.wanted.has(name) ? "ROOT LOST" : "dropped, nothing wants it", name, from, to);
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
    "stringChunkAt\tsomething\nstarts\tnow a reason\nnewRoot\tfinally named\nlying\tx\nwantsIt\tit calls `forgotten`, which was refused above\n",
  );
  const m = moves(before, after);
  // A cascade whose cause left the module is dead code dropped, not a loss.
  const deadBefore = states("func other(x: f64) -> f64 {\n", "dead\tit calls `helper`, and a regular expression literal\nhelper\ta regular expression literal\n");
  const deadAfter = states("func other(x: f64) -> f64 {\nfunc helper(x: f64) -> f64 {\n", "");
  const dead = moves(deadBefore, deadAfter);
  if (dead.has("ROOT LOST") || !(dead.get("dropped, nothing wants it") ?? []).some((x) => x.name === "dead")) return "a function nothing wants any more read as a lost root";
  const names = (k) => (m.get(k) ?? []).map((x) => x.name).sort().join(",");
  if (names("STOPPED COMPILING") !== "starts") return `stopped compiling: ${names("STOPPED COMPILING")}`;
  if (names("DROPPED SILENTLY") !== "goesQuiet") return `dropped silently: ${names("DROPPED SILENTLY")}`;
  if (names("ROOT LOST") !== "forgotten") return `root lost: ${names("ROOT LOST")}`;
  if (names("newly named") !== "newRoot,wantsIt") return `newly named: ${names("newly named")}`;
  if (names("newly compiles") !== "starts2") return `newly compiles: ${names("newly compiles")}`;
  if (m.has("phantom cleared") || m.has("PHANTOM APPEARED")) return "a phantom present in both arms read as a move";
  if ([...m.values()].flat().some((x) => x.name.startsWith("R<"))) return "a renumbered generic instance read as a move";
  // And the loss side must still fire: the same drop with its cause still present.
  // The same message surviving elsewhere is not a caller: the first version's mistake.
  const sameText = moves(states("", "gone\ta regular expression literal\n"), states("", "another\ta regular expression literal\n"));
  if (sameText.has("ROOT LOST")) return "a refusal message written by another site read as the dropped function's caller";
  // And the loss side must still fire: a refusal still cites the absent function.
  const wantedAfter = moves(states("", "gone\tx\n"), states("", "caller\tit calls `gone`, which was refused above\n"));
  if (!wantedAfter.has("ROOT LOST")) return "a function a cascade still cites, gone with no reason, was not a loss";
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
  console.log("  usage: refusal-diff.mjs <before-nts> <after-nts> [project ...] [--one-change]  (both binaries must exist)");
  process.exit(2);
}
// The frontend follows the pin (pin.mjs `frontendFor`), per binary: two
// arms may be two pins, and one shared frontend would serve one the other's.
// None stops the run here, before every project prints nothing and reads as
// no move.
const envFor = new Map();
for (const [name, bin] of [["before", beforeBin], ["after", afterBin]]) {
  const frontend = frontendFor(bin, ROOT);
  if (!frontend.exists) {
    console.log(`  NOT MEASURED: no frontend for the ${name} arm at ${frontend.path} -- set NTS_TSGO, or use a pin (it records its frontend)`);
    process.exit(2);
  }
  envFor.set(bin, { ...process.env, NTS_TSGO: frontend.path });
}
const projects = named.length > 0 ? named : [
  ...readdirSync(join(ROOT, "runtime/node"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(ROOT, "runtime/node", e.name, "tsconfig.json")))
    .map((e) => `runtime/node/${e.name}`),
  "runtime/web-platform",
].sort();

if (process.argv.includes("--one-change")) {
  const why = oneChange(beforeBin, afterBin);
  if (why) {
    console.log(`  NOT MEASURED: --one-change, and ${why}`);
    process.exit(2);
  }
}

const run = (bin, args) => new Promise((done) => {
  const c = spawn(bin, args, { cwd: ROOT, env: envFor.get(bin) });
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
      arms.push({ arm: states(hir.stdout, ref.stdout), refusals: ref.stdout.split("\n").filter(Boolean).length });
    }
    if (arms.every(Boolean)) results.push({ project, moved: moves(arms[0].arm, arms[1].arm), refusals: [arms[0].refusals, arms[1].refusals] });
  }
}));

console.log(`  before ${beforeBin}\n  after  ${afterBin}`);
for (const line of armLines(beforeBin, afterBin)) console.log(`  ${line}`);
// One function moving in every program that imports it is one fact, not N:
// a summary per name first, then the per-project detail.
const byName = new Map();
for (const { project, moved } of results) {
  for (const [kind, list] of moved) for (const { name } of list) {
    const key = `${kind}\t${name}`;
    byName.set(key, [...(byName.get(key) ?? []), project]);
  }
}
if (byName.size > 0) console.log("  by function:");
for (const [key, where] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
  const [kind, name] = key.split("\t");
  console.log(`    ${kind.padEnd(26)} ${name} -- in ${where.length} project(s)`);
}
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
