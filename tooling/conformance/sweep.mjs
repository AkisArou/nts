// Every module, both modes, as the table the conformance doc carries.
//
//   node tooling/conformance/sweep.mjs [--modules a,b,c] [--no-sabotage]
//                                     [--compiles]
//
// Two reasons this exists rather than thirteen invocations typed by hand.
//
// The first is drift. The per-module table in `docs/conformance/nodejs.md` was
// hand-copied, and a hand-copied number is a claim nobody can check -- which is
// the same failure as a measurement that cannot go red, one level up. The rows
// this prints are the rows that belong in the document.
//
// `--compiles` adds the other axis: `nts hir` per module, lowered and refused.
// It is off by default because it is slow, and it exists because a change to
// this profile's *source* can cost lowered functions in a module it did not
// touch. Adding argument validation to `node:buffer` cost `node:fs` ten,
// measured only because a compiler change happened to prompt a re-run. A
// behaviour sweep cannot see that: node's tests do not care whether a function
// lowered.
//
// The second is that a change to shared code costs its passes somewhere other
// than where it was aimed. `internal/errors.ts`, `util/src/inspect.ts` and
// `deep-equal.ts` are under every module here, and a sweep that covers only the
// module being worked on would report the win and miss the cost.

import { readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";

const HERE = import.meta.dirname;
const ROOT = resolve(HERE, "../..");
const PROFILE = join(ROOT, "runtime/node");

const argv = process.argv;
const arg = (name) => {
  const at = argv.indexOf(name);
  return at === -1 ? null : argv[at + 1];
};
const withSabotage = !argv.includes("--no-sabotage");
const withCompiles = argv.includes("--compiles");

const requested = arg("--modules");
const modules = requested
  ? requested.split(",").map((m) => m.trim()).filter(Boolean)
  : readdirSync(PROFILE, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(PROFILE, e.name, "src/main.ts")))
      .map((e) => e.name)
      .sort();

/**
 * `nts hir` for one module: how many functions lowered, how many constructs
 * refused. `null` when the compiler is not built, which is not a failure --
 * this axis is optional.
 */
function compiles(module) {
  try {
    const out = execFileSync(
      join(ROOT, "target/release/nts"),
      ["hir", join(PROFILE, module, "tsconfig.json")],
      {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NTS_TSGO: join(ROOT, "target/tsgo") },
      },
    );
    const match = /(\d+) function\(s\), (\d+) construct\(s\) refused/.exec(out);
    return match ? { lowered: Number(match[1]), refused: Number(match[2]) } : null;
  } catch {
    return null;
  }
}

/** One module, one mode. Returns the tally the runner reported. */
function run(module, sabotage) {
  const args = [join(HERE, "run.mjs"), "--module", module, "--json"];
  if (sabotage) args.push("--sabotage");
  try {
    const out = execFileSync(process.execPath, args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out).tally;
  } catch (e) {
    // A non-zero exit is the normal case: the runner reports failures that way.
    try {
      return JSON.parse(e.stdout ?? "").tally;
    } catch {
      return null;
    }
  }
}

const rows = [];
let totalPass = 0;
let totalHollow = 0;

for (const module of modules) {
  const started = Date.now();
  const real = run(module, false);
  if (real === null) {
    console.error(`  ${module}: the runner produced nothing`);
    continue;
  }
  const hollow = withSabotage ? run(module, true)?.pass ?? null : null;
  const lowering = withCompiles ? compiles(module) : null;
  const applicable = real.pass + real.fail;
  totalPass += real.pass;
  if (hollow !== null) totalHollow += hollow;
  rows.push({ module, pass: real.pass, applicable, hollow, lowering });
  process.stderr.write(
    `  ${module.padEnd(22)} ${String(real.pass).padStart(3)} / ${String(applicable).padEnd(4)}` +
      `${hollow === null ? "" : ` hollow ${hollow}`}` +
      `  (${((Date.now() - started) / 1000).toFixed(0)}s)\n`,
  );
}

// Best first, as the document orders them: a reader wants the finished modules
// at the top and the ones with the most left to do at the bottom.
rows.sort((a, b) => (b.pass / (b.applicable || 1)) - (a.pass / (a.applicable || 1)));

console.log(`\n| module | node's tests | hollow |${withCompiles ? " compiles |" : ""}`);
console.log(`| --- | :---: | :---: |${withCompiles ? " :---: |" : ""}`);
let totalLowered = 0;
for (const { module, pass, applicable, hollow, lowering } of rows) {
  const complete = applicable > 0 && pass === applicable;
  const count = complete ? `**${pass} / ${applicable}**` : `${pass} / ${applicable}`;
  const compiled = lowering ? `${lowering.lowered} / ${lowering.refused}` : "—";
  if (lowering) totalLowered += lowering.lowered;
  console.log(
    `| \`${module}\` | ${count} | ${hollow ?? "—"} |${withCompiles ? ` ${compiled} |` : ""}`,
  );
}
console.log(
  `\n${totalPass} of node's own test files pass across ${rows.length} modules` +
    (withSabotage ? `, of which ${totalHollow} are hollow.` : "."),
);
if (withCompiles) {
  console.log(`${totalLowered} functions lower.`);
}
