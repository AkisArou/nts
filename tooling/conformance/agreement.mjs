// A compiled program that answers differently from node.
//
//   NTS_BIN=<a pinned copy> node tooling/conformance/agreement.mjs
//   NTS_BIN=<...> node tooling/conformance/agreement.mjs an-optional-field-across-an-erased-slot
//
// # The gap this fills, which was demonstrated rather than imagined
//
// On 2026-09-09 the compiler lane fixed `options = {}` -- the empty object
// literal under 332 of this profile's failing test files -- measured it, and
// **reverted it**, because with the fix in, an object assigned into an erased
// slot came back as the wrong shape and a program answered `-2` where node
// answers `19`. A refusal had become a wrong answer.
//
// **Nothing in this directory would have caught that**, and the four candidates
// each miss it for a different reason:
//
//     blockers/                asserts a refusal, and this is not one
//     differential-ts.mjs      runs the TypeScript on node, so both sides are node
//     differential-addon.mjs   needs a whole module and its node counterpart
//     examples/                a case is written because it *agrees* with node
//
// A fixture-sized program that compiles, runs, and answers differently had no
// home. This is that home.
//
// # How it asks
//
// Each case is a directory with a `src/main.ts` and a `cases.mjs`. The program
// is compiled to an addon and each named export is called; the same source is
// then imported on node and the same export called there. The two answers are
// compared.
//
// **Every case takes nothing and answers a scalar, and that is a rule rather
// than a convenience.** The defect this was built for lives in how an object
// crosses an erased slot; calling through the addon boundary with an object
// would add a second erasure, and a disagreement could then be either one. The
// interesting work happens inside the compiled program and only a number comes
// out.
//
// # What a disagreement means
//
// That the compiler produced a program which runs and is wrong, which is worse
// than a refusal and is the thing this profile trades refusals to avoid. A case
// here is expected to disagree until it is fixed, and to be kept afterwards as
// the guard that it stays fixed.
//
// A case that fails to compile is reported as that and not as agreement --
// "did not build" and "agrees" are opposite findings, and this directory has
// confused them in both lanes before.

import { existsSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const compiler = process.env.NTS_BIN ?? process.env.NTS_COMPILER ?? join(ROOT, "target/release/nts");

if (!existsSync(compiler)) {
  console.error(`no compiler at ${compiler}`);
  process.exit(2);
}

const RUN_ROOT = mkdtempSync(join(tmpdir(), "nts-agreement-"));
process.on("exit", () => {
  if (process.env.NTS_KEEP_TEMP === undefined) {
    try { rmSync(RUN_ROOT, { recursive: true, force: true }); } catch { /* going away */ }
  } else {
    console.log(`  kept ${RUN_ROOT}`);
  }
});

const DIR = join(HERE, "agreements");
const argv = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const names = argv.length > 0
  ? argv
  : readdirSync(DIR).filter((d) => existsSync(join(DIR, d, "src", "main.ts"))).sort();

let compared = 0;
let disagreeing = 0;
let unbuilt = 0;
let refusedTotal = 0;

for (const name of names) {
  const dir = join(DIR, name);
  const { cases } = await import(pathToFileURL(join(dir, "cases.mjs")).href);

  const out = mkdtempSync(join(RUN_ROOT, "emit-"));
  const emit = spawnSync(compiler, ["emit-c", join(dir, "tsconfig.json"), "--out", out, "--napi"], {
    encoding: "utf8", env: { ...process.env, NTS_TSGO: join(ROOT, "target/tsgo") },
  });
  const sources = existsSync(out) ? readdirSync(out).filter((f) => f.endsWith(".c")).map((f) => join(out, f)) : [];
  if (sources.length === 0) {
    console.log(`  DID NOT EMIT    ${name}`);
    console.log(`                  ${`${emit.stdout ?? ""}${emit.stderr ?? ""}`.split("\n")[0].slice(0, 78)}`);
    unbuilt += 1;
    continue;
  }

  const addon = join(out, "case.node");
  const internal = readdirSync(join(ROOT, "runtime/node/internal"))
    .filter((f) => f.endsWith(".c")).map((f) => join(ROOT, "runtime/node/internal", f));
  const link = spawnSync("clang", [
    "-std=c11", "-O0", "-D_GNU_SOURCE", "-fPIC", "-shared", "-fvisibility=hidden",
    "-I", out,
    "-I", join(ROOT, "third_party/node/src"),
    "-I", join(ROOT, "third_party/node/deps/uv/include"),
    "-I", join(ROOT, "runtime/node/internal"),
    "-o", addon, ...sources, ...internal, "-luv", "-lm",
  ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (link.status !== 0) {
    console.log(`  DID NOT LINK    ${name}`);
    const errors = `${link.stdout ?? ""}${link.stderr ?? ""}`.split("\n").filter((l) => l.includes("error:"));
    for (const line of errors.slice(0, 2)) console.log(`                  ${line.slice(0, 78)}`);
    unbuilt += 1;
    continue;
  }

  // **One export per child.** A compiled function can take the process down --
  // the first run of `optional-fields-through-erased-slots` exited on a signal
  // and lost all six answers, when five of them had something to say. A crash
  // is the strongest finding this instrument can produce and it must not cost
  // the others.
  const answerOf = (call) => {
    const probe = `
      const flags = require("node:os").constants.dlopen;
      const m = { exports: {} };
      try { process.dlopen(m, ${JSON.stringify(addon)}, flags.RTLD_NOW); }
      catch (e) { console.log(JSON.stringify({ ok: false, why: "did not load: " + String(e.message).slice(0, 70) })); process.exit(0); }
      const fn = m.exports[${JSON.stringify(call)}];
      if (typeof fn !== "function") { console.log(JSON.stringify({ ok: false, why: "not published" })); process.exit(0); }
      try { console.log(JSON.stringify({ ok: true, value: fn() })); }
      catch (e) { console.log(JSON.stringify({ ok: false, why: "threw: " + String(e && e.message).slice(0, 60) })); }
    `;
    const run = spawnSync(process.execPath, ["-e", probe], { encoding: "utf8", timeout: 60_000 });
    const line = `${run.stdout ?? ""}`.trim().split("\n").filter((l) => l.startsWith("{")).pop();
    if (line === undefined) {
      // 128+n is a signal; this is the case the per-child split exists for.
      const how = run.status === null || run.status > 128
        ? `CRASHED, signal ${run.signal ?? (run.status ?? 0) - 128}`
        : `no answer (exit ${run.status})`;
      return { ok: false, why: how };
    }
    return JSON.parse(line);
  };
  // **A refusal is not a disagreement, and counting them together defeats the
  // point of the file.** This exists because a wrong answer is worse than a
  // refusal; a run that reports "not published" as a disagreement has just
  // equated them. `perIterationBinding` and `getterCalledEachRead` were refused
  // outright on the first sweep and were reported alongside a segfault and a
  // garbage double, which is three different severities in one column.
  //
  // A refused case belongs in `blockers/`, and is reported here as a refusal so
  // it can be moved there rather than counted as evidence of anything.
  const compiledSide = { loaded: true, answers: {}, refused: [] };
  for (const c of cases) {
    const answer = answerOf(c.call);
    if (answer.ok !== true && answer.why === "not published") {
      compiledSide.refused.push(c.call);
      continue;
    }
    compiledSide.answers[c.call] = answer.ok === true ? answer.value : answer.why;
  }

  // Node's answers, from the same source.
  const onNode = await import(pathToFileURL(join(dir, "src", "main.ts")).href);

  const rows = [];
  for (const c of cases) {
    if (compiledSide.refused.includes(c.call)) continue;
    let theirs;
    try { theirs = typeof onNode[c.call] === "function" ? onNode[c.call]() : "(not exported)"; }
    catch (e) { theirs = `threw: ${String(e && e.message).slice(0, 60)}`; }
    const ours = compiledSide.answers[c.call];
    compared += 1;
    if (!Object.is(ours, theirs)) {
      disagreeing += 1;
      rows.push({ call: c.call, why: c.why, ours, theirs });
    }
  }

  refusedTotal += compiledSide.refused.length;
  const asked = cases.length - compiledSide.refused.length;
  const refusedNote = compiledSide.refused.length === 0
    ? ""
    : `, ${compiledSide.refused.length} refused (${compiledSide.refused.join(", ")})`;
  if (rows.length === 0) {
    console.log(`  agrees          ${name}  (${asked} case(s)${refusedNote})`);
    continue;
  }
  console.log(`  DISAGREES       ${name}  (${asked} asked${refusedNote})`);
  for (const r of rows) {
    console.log(`      ${r.call}: compiled ${JSON.stringify(r.ours)}, node ${JSON.stringify(r.theirs)}`);
    console.log(`          ${r.why}`);
  }
}

if (names.length === 0) {
  console.log("  INSTRUMENT FAILURE: no case directory found under agreements/.");
  console.log("  An empty run is not a clean run.");
  process.exit(2);
}
console.log(`\n  ${compared} case(s) compared, ${disagreeing} disagreeing, ${refusedTotal} refused, ` +
  `${unbuilt} case(s) that did not build.`);
console.log("  A refused case is a blocker and belongs in blockers/; it is counted apart");
console.log("  because a wrong answer is worse than a refusal and this file exists to say so.");
console.log("  A disagreement is a program that runs and is wrong, which is worse than a");
console.log("  refusal and is what this profile trades refusals to avoid. A case that did");
console.log("  not build is neither agreement nor disagreement and is counted apart.");
