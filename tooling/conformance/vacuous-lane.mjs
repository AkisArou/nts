/**
 * Find passes that no mutation lane can discredit.
 *
 * `--sabotage` blanks the module; `--mutate-addon` keeps its names and destroys
 * their behaviour. Both ask a question about *exports*, so both are silent on
 * the module that publishes none: there is nothing to blank and nothing to
 * poison, and a test comparing two absent values agrees with itself under every
 * lane we have.
 *
 * `fs` is the case that prompted this. It passes `test-fs-promises-exists.js`,
 * survives sabotage, and publishes zero exports -- the file asserts
 * `fsPromises.constants === fs.constants` and both sides are `undefined`.
 *
 * So this lane does not mutate anything. It states the arithmetic directly: an
 * addon that publishes nothing cannot be the subject of a passing test, and any
 * pass it records is measuring the harness, the shape, or node's own globals.
 */
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const only = argv.filter((a) => !a.startsWith("--"));

/**
 * Counted in a child. A lazily-bound addon aborts the process on its first
 * unresolved call, and an abort in *this* process would end the sweep at
 * whichever module happened to be first rather than reporting it as one row.
 */
function exportCount(addon) {
  const src = `const m=require(${JSON.stringify(addon)});console.log(Object.keys(m).length)`;
  try {
    return Number(execFileSync(process.execPath, ["-e", src], { encoding: "utf8" }).trim());
  } catch {
    return null;
  }
}

/**
 * `spawnSync`, not `execFileSync`, and the difference is the whole measurement.
 *
 * `run.mjs` exits non-zero whenever a test fails, so `execFileSync` threw for
 * every module with a failure and this lane printed "not measurable" -- for
 * `events`, `querystring` and `url` at once. It would have reported "0 vacuous"
 * while being blind to precisely the modules that publish nothing and fail
 * nearly everything, which is the population it exists to search. A non-zero
 * exit here is the normal case; only unparseable output is a real absence.
 */
function passCount(module, addon) {
  const r = spawnSync(
    process.execPath,
    [resolve(HERE, "run.mjs"), "--module", module, "--addon", addon, "--json"],
    { encoding: "utf8", cwd: ROOT, maxBuffer: 64 * 1024 * 1024 },
  );
  if (!r.stdout) return null;
  try {
    return JSON.parse(r.stdout).tally;
  } catch {
    return null;
  }
}

const modules = (
  only.length
    ? only
    : readdirSync(resolve(ROOT, "runtime/node"), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
).sort();

let flagged = 0;
let checked = 0;
console.log("module               exports   pass   fail   verdict");
for (const module of modules) {
  const addon = resolve(ROOT, "target/node", `${module}.node`);
  if (!existsSync(addon)) continue;
  const exports = exportCount(addon);
  const tally = passCount(module, addon);
  if (exports === null || tally === null) {
    console.log(`${module.padEnd(20)} ${"?".padStart(7)}   ----   ----   not measurable`);
    continue;
  }
  checked++;
  // A module publishing nothing is the whole condition. It needs no second
  // signal: every pass it holds is held by something other than the module.
  const vacuous = exports === 0 && tally.pass > 0;
  if (vacuous) flagged++;
  console.log(
    `${module.padEnd(20)} ${String(exports).padStart(7)} ` +
      `${String(tally.pass).padStart(6)} ${String(tally.fail).padStart(6)}   ` +
      (vacuous ? `VACUOUS — ${tally.pass} pass(es) on an addon publishing nothing` : "ok"),
  );
}
console.log(`\n${checked} module(s) measured, ${flagged} vacuous.`);
process.exit(flagged > 0 ? 1 : 0);
