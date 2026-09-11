// Which single refusal, fixed, would publish the most names across the profile.
//
//   NTS_COMPILER=<a pinned copy> node tooling/conformance/export-reach.mjs
//   NTS_COMPILER=<pinned> node tooling/conformance/export-reach.mjs dns zlib
//
// # The question the other two do not ask
//
// `blocker-reach.mjs` counts how many **modules** a refusal shape stops.
// `cascade-reach.mjs` names, for **one** module, which export sits behind which
// refusal. Neither answers the one the goal turns on: the compiled axis publishes
// 73 of node's 505 names, so which fix publishes the most of the missing 432.
//
// This runs `emit-c --napi` over every module, walks the `NTS1003` call chain from
// each declined export back to the function that was refused on its own account,
// and sums the exports per terminal function across all of them.
//
// # Attribution is by chain, never by adjacency
//
// This exists because I got that wrong by hand. `cascade-reach.mjs` printed a
// refusal it could not attribute, directly under the module's largest cone, and I
// read the neighbouring row as the cause. It was not: the export was blocked by a
// generic rest parameter, and I had told another session to prioritise a `WeakMap`.
//
// So the only edges used here are the ones `NTS1003` states outright --
// "`X` cannot be compiled because it calls `Y`" -- and a chain that does not reach
// a terminal function is reported as **unattributed** rather than assigned to
// anything nearby. The unattributed count is printed beside the results, because a
// ranking that quietly drops what it could not follow is a ranking of what was
// easy to follow.
//
// # What a row means, and what it does not
//
// A row says: these exports are declined, and the chain from each ends at this
// function. Fixing that function is necessary for them, not sufficient. A row
// sizes a queue.
//
// **How much of a queue was measured, and it is more than "can reveal".** The
// compiler reports the *first* refused callee a function has and stops. `dns`'s
// `lookup` read "cannot be compiled because it calls `nextTick`"; a throwaway
// worktree gave `nextTick` a non-generic sibling that lowers, and `lookup` then
// read "because it calls `isIP`" -- a second, independent blocker (a module-scope
// `new RegExp` under `net/src/address.ts`) that no output had ever named while the
// first one stood.
//
// So a terminal is the head of a chain whose length is unknown. Every count here
// is an upper bound on what one fix publishes, and the bound is not tight: an
// export attributed to a terminal may sit behind two more after it. Read a row as
// "this many exports cannot proceed until X is fixed", never as "fixing X
// publishes this many".
//
// The terminal function's *own* refusal message is not inferred here. Look it up
// with `grep -n "NTS1001" ` over that module's build output, which names it on one
// line. That is the step whose absence produced the mistake above.

import { spawnSync } from "node:child_process";
import { loadOurs, loadNode } from "./surface-load.mjs";
import { existsSync, readdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const PROFILE = join(ROOT, "runtime/node");
const compiler = process.env.NTS_COMPILER ?? process.env.NTS_BIN ?? join(ROOT, "target/release/nts");

if (!existsSync(compiler)) {
  console.error(`no compiler at ${compiler}`);
  process.exit(2);
}

const requested = process.argv.slice(2);
const modules = (requested.length > 0 ? requested : readdirSync(PROFILE))
  .filter((m) => existsSync(join(PROFILE, m, "tsconfig.json")));

/** `X cannot be compiled because it calls Y, which was refused above`. */
const EDGE = /NTS1003 `([^`]+)` cannot be compiled because it calls `([^`]+)`/;
/** `no wrapper for NAME: ...` */
const DECLINED = /^\s*no wrapper for ([^:]+): (.*)$/;

const perFunction = new Map();   // terminal function -> [ "module.export", ... ]
const unnameable = [];           // [module, export] the wrapper cannot name at all
let declinedTotal = 0;
let unattributed = 0;
const unattributedBy = new Map();

for (const module_ of modules) {
  const out = mkdtempSync(join(tmpdir(), "nts-export-reach-"));
  const run = spawnSync(compiler, ["emit-c", join(PROFILE, module_, "tsconfig.json"), "--out", out, "--napi"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: 3_600_000,
    env: { NTS_TSGO: join(ROOT, "target/tsgo"), ...process.env },
  });
  const lines = `${run.stdout ?? ""}${run.stderr ?? ""}`.split("\n");

  // caller -> callee, from the cascade's own statements and nothing else.
  const callee = new Map();
  for (const line of lines) {
    const m = EDGE.exec(line);
    if (m !== null && !callee.has(m[1])) callee.set(m[1], m[2]);
  }

  const declined = [];
  for (const line of lines) {
    const m = DECLINED.exec(line);
    if (m !== null) declined.push({ name: m[1].trim(), reason: m[2].trim() });
  }
  declinedTotal += declined.length;

  for (const { name, reason } of declined) {
    // Only the ones whose absence is a *compilation* outcome. "is not a function
    // this backend can name" is a wrapper limit and belongs to a different
    // question, so it is counted apart rather than folded in.
    if (!/no function of that name was compiled|whose function was not compiled|whose constructor was not compiled/.test(reason)) {
      unattributed++;
      unattributedBy.set(reason, (unattributedBy.get(reason) ?? 0) + 1);
      if (/is not a function this backend can name/.test(reason)) {
        unnameable.push([module_, name]);
      }
      continue;
    }
    let cursor = name;
    const seen = new Set([cursor]);
    while (callee.has(cursor)) {
      const next = callee.get(cursor);
      if (seen.has(next)) break;      // a cycle is not a terminal
      seen.add(next);
      cursor = next;
    }
    // An export with no outgoing NTS1003 edge was refused on its **own** account:
    // it has an NTS1001 in its own body and calls nothing that was refused first.
    // It is therefore its own terminal, not an attribution failure. The first
    // version of this counted those as unattributed and reported 39 of zlib's 66
    // as unanswerable, which was the instrument describing its own bug.
    const key = cursor;
    if (!perFunction.has(key)) perFunction.set(key, []);
    perFunction.get(key).push(`${module_}.${name}`);
  }
  process.stderr.write(`  ${module_}: ${declined.length} declined\n`);
}

const ranked = [...perFunction.entries()].sort((a, b) => b[1].length - a[1].length);
console.log(`\n  ${modules.length} module(s), ${declinedTotal} declined export(s).`);
console.log(`  ${declinedTotal - unattributed} attributed to a terminal function by NTS1003 chain, ${unattributed} not.\n`);
console.log("  exports  terminal function");
for (const [fn, exports] of ranked.slice(0, 25)) {
  console.log(`  ${String(exports.length).padStart(7)}  ${fn}`);
  const modulesHit = [...new Set(exports.map((e) => e.split(".")[0]))];
  console.log(`           ${modulesHit.length} module(s): ${modulesHit.join(" ")}`);
}
// Every terminal, one per line, for a reader that is not a person. The pretty
// section above stops at 25, and a first attempt to analyse this by parsing that
// section read the indented "N module(s): ..." continuation lines as data rows --
// the count it produced was over a population of about fifteen real terminals and
// half as many pieces of nonsense. One row per line, no continuations.
console.log("\n  --- all terminals, TSV: exports, function, modules ---");
for (const [fn, exports] of ranked) {
  const modulesHit = [...new Set(exports.map((e) => e.split(".")[0]))];
  console.log(`TERMINAL\t${exports.length}\t${fn}\t${modulesHit.join(",")}`);
}

if (unattributed > 0) {
  console.log(`\n  The ${unattributed} not attributed, by the reason given:`);
  for (const [reason, count] of [...unattributedBy.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(7)}  ${reason.slice(0, 70)}`);
  }
  console.log("\n  These are not failures of the modules; they are the part of the");
  console.log("  question this instrument cannot answer, printed so the ranking above");
  console.log("  is read as covering what it covers.");
}

// **What the unnameable ones actually are.** "is not a function this backend can
// name" is the largest single bucket and says only what the export is *not*.
// Grouping by the value's kind answers whether it is one mechanism or several,
// which is what decides whether the bucket is one piece of work.
//
// The kind comes from loading the module on the interpreted lane and looking at
// the value, so this is the one part of the file that runs anything. A module
// that fails to load is counted as that rather than dropped.
if (unnameable.length > 0) {
  const kinds = new Map();
  const byModule = new Map();
  for (const [m, name] of unnameable) {
    if (!byModule.has(m)) byModule.set(m, []);
    byModule.get(m).push(name);
  }
  const add = (kind, label) => {
    if (!kinds.has(kind)) kinds.set(kind, []);
    kinds.get(kind).push(label);
  };
  for (const [m, names] of byModule) {
    // Whether node publishes the name at all comes first, because a name node
    // does not have is not a gap. Our TypeScript exports internals that
    // `shape.mjs` deletes -- `default`, `Console_`, `globalConsole` -- and the
    // wrapper complains about every one of them on its way past.
    let theirs = null;
    try { const t = loadNode(m); theirs = t.absent ? null : t.surface; } catch { theirs = null; }
    let surface;
    try {
      const ours = await loadOurs(m);
      if (ours.absent) {
        for (const n of names) add(`module did not load (${ours.absent})`, `${m}.${n}`);
        continue;
      }
      surface = ours.surface;
    } catch {
      for (const n of names) add("module threw on load", `${m}.${n}`);
      continue;
    }
    for (const n of names) {
      if (theirs !== null && !(n in theirs)) {
        add("NOT PUBLISHED BY NODE -- not a gap", `${m}.${n}`);
        continue;
      }
      let value;
      try { value = surface[n]; } catch { add("threw on access", `${m}.${n}`); continue; }
      if (value === undefined) { add("absent from the shaped surface", `${m}.${n}`); continue; }
      if (typeof value === "function") {
        const isClass = value.prototype !== undefined
          && Object.getOwnPropertyNames(value.prototype).length > 1;
        add(isClass ? "a class" : "a function the wrapper declined anyway", `${m}.${n}`);
        continue;
      }
      if (typeof value !== "object" || value === null) { add(`a ${typeof value}`, `${m}.${n}`); continue; }
      const entries = Object.entries(value);
      const fns = entries.filter(([, v]) => typeof v === "function").length;
      const primitives = entries.filter(([, v]) =>
        v === null || (typeof v !== "object" && typeof v !== "function")).length;
      if (entries.length === 0) add("an empty object", `${m}.${n}`);
      else if (fns === 0 && primitives === entries.length) add("a constants table, no functions", `${m}.${n}`);
      else if (fns === entries.length) add("a namespace of functions", `${m}.${n}`);
      else add(`a mixed object (${fns} fn of ${entries.length})`, `${m}.${n}`);
    }
  }
  console.log(`\n  The ${unnameable.length} "not a function this backend can name", by what the value is:`);
  for (const [kind, labels] of [...kinds.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(labels.length).padStart(7)}  ${kind}`);
    console.log(`           ${labels.slice(0, 10).join(" ")}${labels.length > 10 ? ` ... +${labels.length - 10}` : ""}`);
  }
}
