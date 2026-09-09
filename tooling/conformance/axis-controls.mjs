// What each compiled-lane pass actually depends on.
//
//   node tooling/conformance/axis-controls.mjs
//   node tooling/conformance/axis-controls.mjs os path
//
// # The two-way split was wrong, and it was wrong about my own test
//
// The compiled axis has been reported as `plain - degenerate`, where degenerate
// is the pass count under `--mutate-addon`. That subtraction says a pass which
// survives mutation measures nothing.
//
// It does not. `os/test/constants-signals-static.js` was written to replace an
// upstream file whose assertion an absent `constants` satisfies, and it checks
// that `constants.signals` is a frozen object. It **survives `--mutate-addon`**,
// because mutation keeps the addon's names and destroys its *behaviour*, and a
// frozen data table has none to destroy. By the two-way arithmetic it was
// hollow, and I was a commit away from recording it as such.
//
// It fails `--empty-exports` and it fails `--sabotage`. It measures the addon.
//
// `run.mjs` says this in its own comment -- values agreeing is "the one
// comparison neither sabotage nor `--mutate-addon` can express" -- and the
// arithmetic built on top of it forgot.
//
// # Three outcomes, not two
//
//     hollow       passes under `--sabotage` or `--empty-exports`, so it passes
//                  with no module at all. Measures nothing.
//     shape-only   survives `--mutate-addon` but needs the module to exist.
//                  Measures what the addon publishes, not what it computes.
//     behaviour    fails every control. Measures what the addon does.
//
// `hollow` is the finding. `shape-only` is a real pass on a narrower claim, and
// calling it hollow understates the axis; calling it behaviour overstates it.
//
// # Reading it
//
// A module whose passes are all `shape-only` publishes a correct surface and has
// not been shown to compute anything. That is a result and not a blank -- it is
// exactly what `os` was for its first two passes -- but it is not the axis
// advancing, and the sweep's `every-pass-hollow` label does not distinguish it.

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");

// `target/node` is shared with the other sessions in this tree. Measuring it
// means measuring whatever they last wrote: a 22-module run reported
// `buffer 0 passed` while another session rebuilt the directory underneath it,
// alphabetically, and a re-run minutes later on the same md5 said `1 passed`.
//
// `NTS_ADDON_OUT` is the same variable `build.sh` takes, so a run builds into
// its own directory and reads back what it built.
const ADDON_DIR = process.env.NTS_ADDON_OUT ?? join(ROOT, "target/node");

/** The set of test files that pass, under one control or none. */
function passing(module, addon, flag) {
  const args = ["tooling/conformance/run.mjs", "--module", module, "--addon", addon];
  if (flag !== null) args.push(flag);
  const run = spawnSync(process.execPath, args, {
    cwd: ROOT, encoding: "utf8", timeout: 1_800_000,
  });
  const out = `${run.stdout ?? ""}`;
  const set = new Set();
  for (const line of out.split("\n")) {
    const m = /^\s{2}pass\s{2}(.+)$/.exec(line);
    if (m !== null) set.add(m[1].trim());
  }
  return set;
}

const argv = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const modules = argv.length > 0
  ? argv
  : readdirSync(join(ROOT, "runtime/node"))
    .filter((m) => m !== "node_modules" && existsSync(join(ADDON_DIR, `${m}.node`)))
    .sort();

let tHollow = 0, tShape = 0, tBehaviour = 0;
const withAny = [];

for (const module of modules) {
  const addon = join(ADDON_DIR, `${module}.node`);
  const plain = passing(module, addon, null);
  if (plain.size === 0) continue;

  const mutate = passing(module, addon, "--mutate-addon");
  const empty = passing(module, addon, "--empty-exports");
  const sabotage = passing(module, addon, "--sabotage");

  const hollow = [...plain].filter((f) => empty.has(f) || sabotage.has(f));
  const rest = [...plain].filter((f) => !empty.has(f) && !sabotage.has(f));
  const shapeOnly = rest.filter((f) => mutate.has(f));
  const behaviour = rest.filter((f) => !mutate.has(f));

  tHollow += hollow.length; tShape += shapeOnly.length; tBehaviour += behaviour.length;
  withAny.push(module);

  console.log(
    `${module}: ${plain.size} pass -- ${behaviour.length} behaviour, ` +
    `${shapeOnly.length} shape-only, ${hollow.length} hollow`,
  );
  for (const f of behaviour) console.log(`    behaviour   ${f}`);
  for (const f of shapeOnly) console.log(`    shape-only  ${f}`);
  for (const f of hollow) console.log(`    HOLLOW      ${f}`);
}

console.log();
if (withAny.length === 0) {
  console.log("  INSTRUMENT FAILURE: no module passed a single file, so no control");
  console.log("  was ever exercised. An empty run is not a clean run.");
  process.exit(2);
}
console.log(
  `  ${tBehaviour} behaviour-dependent, ${tShape} shape-only, ${tHollow} hollow ` +
  `across ${withAny.length} module(s)`,
);
console.log("  behaviour + shape-only is what the compiled lane demonstrates.");
console.log("  hollow is the number to drive to zero; shape-only is a real pass");
console.log("  on a narrower claim than the axis is usually reported to make.");
