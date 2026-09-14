/**
 * Exclusions whose stated reason has stopped being true.
 *
 * A `not-applicable` entry reading "skipped because `constants` is absent" is
 * correct until `constants` is published, and then it is a test being skipped
 * for a reason that no longer holds -- which is indistinguishable, in every
 * count this profile keeps, from a test that does not exist.
 *
 * Nothing re-examines them. `sweep.mjs` checks that every entry has a reason
 * and names a file the suite has; neither question is whether the reason is
 * still true. Twelve of the 429 entries are conditional on something being
 * absent, and an absence is exactly the kind of fact that stops being one.
 *
 * **Controlled rather than trusted.** Pointed at a synthetic line reading
 * "skipped because `hostname` is absent" against `os`, which publishes
 * `hostname`, it flags. Pointed at the real line naming `constants`, which `os`
 * does not publish, it does not. A detector that has never fired is a claim
 * about the corpus rather than a measurement of it.
 *
 * The name match is deliberately narrow: a backticked identifier in a line
 * whose reason mentions absence. A reason that describes an absent export in
 * prose without naming it goes unchecked, and that is a limit rather than a
 * bug -- the alternative is guessing which noun is an export.
 *
 * # An absent **module** is the other kind, and this missed one
 *
 * On 2026-09-14 `child_process/not-applicable` was found to justify an exclusion with
 * "the subject is cluster, **which this profile does not implement**" -- true when
 * written, and false since `cluster` reached 85 of 89. This tool reported
 * "0 whose named export is now published" over that very file, correctly and
 * uselessly, because it was blind three ways at once:
 *
 *   the phrase       `does not implement` was not in `ABSENCE`
 *   the subject      only exports were checked, never whether a **module** now exists
 *   the population   a module with no addon `continue`d, so its whole list went unread
 *
 * The third is the one worth naming: the export check needs an addon, so the loop
 * skipped every list belonging to a module that does not build one -- and then the
 * summary counted the entries it had managed to read as though they were all of them.
 * The module check needs no addon, so it now runs either way and the two are reported
 * apart.
 *
 * `extra-tests` is read as well as `not-applicable`, because the sibling instance of
 * that same stale sentence was in `cluster/extra-tests`, where it kept a file claimed
 * by the wrong module.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// `target/node` is shared with the other sessions in this tree, so a run that
// names it reads whatever they last wrote. `NTS_ADDON_OUT` is the variable
// `build.sh`, `loads.sh` and `axis-controls.mjs` take; the default is unchanged.
const ADDON_DIR = process.env.NTS_ADDON_OUT ?? resolve(ROOT, "target/node");
const require = createRequire(import.meta.url);
const ABSENCE = /absent|not published|missing|does not publish|does not implement|not implemented/i;
/**
 * A reason that ties a named module to the claim that it is unimplemented.
 *
 * Narrow on purpose. Reasons mention other modules constantly and almost never mean
 * "and that module does not exist"; only this construction does, and it is the one
 * that was found stale. Backticks optional, because the instance had none.
 */
const UNIMPLEMENTED = [
  /`?([a-z_][\w]*)`?,?\s+which this profile does not implement/gi,
  /(?:does not implement|has not implemented)\s+`?([a-z_][\w]*)`?/gi,
];

/** Module directories, which is what "this profile implements X" is true of. */
const MODULES = new Set(
  readdirSync(resolve(ROOT, "runtime/node"), { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "node_modules" &&
      existsSync(resolve(ROOT, "runtime/node", d.name, "tsconfig.json")))
    .map((d) => d.name),
);
/**
 * An absence in the **control lane** is not an absence in the build.
 *
 * `os/test-os-constants-signals.js` reads "an absent `constants` value throws
 * the same TypeError that the test expects ... **so it passes empty-module
 * sabotage**". The absence there is what `--sabotage` and `--empty-exports`
 * create on purpose; it is true whatever the real build publishes, and the
 * exclusion stays correct forever.
 *
 * This flagged it as stale the day `constants` published, and it was wrong:
 * with the entry removed, the test still passes under `--sabotage`,
 * `--empty-exports` and `--mutate-addon`. Measured before believing the flag,
 * and the entry was put back.
 *
 * So an entry naming a control lane is about that lane and is skipped here. The
 * cost is a false negative if a reason mentions sabotage *and* a real absence,
 * which is why the skipped ones are counted and reported rather than dropped.
 */
const CONTROL_LANE = /sabotage|empty-module|empty exports|--mutate-addon|blanked/i;

let conditional = 0;
let controlLane = 0;
let stale = 0;
let staleModules = 0;
let listsRead = 0;
let listsWithoutAddon = 0;
for (const entry of readdirSync(resolve(ROOT, "runtime/node"), { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "node_modules") continue;
  // **No addon disables the export check and nothing else.** It used to `continue`,
  // which dropped the module's whole list from a count that then reported a total.
  let published = null;
  try {
    const addon = require(resolve(ADDON_DIR, `${entry.name}.node`));
    published = new Set(Object.keys(addon).filter((k) => addon[k] !== undefined));
  } catch {
    listsWithoutAddon++;
  }

  for (const name of ["not-applicable", "extra-tests"]) {
    const list = resolve(ROOT, "runtime/node", entry.name, name);
    if (!existsSync(list)) continue;
    listsRead++;
    for (const line of readFileSync(list, "utf8").split("\n")) {
      if (!line.trim() || line.startsWith("#")) continue;
      if (!ABSENCE.test(line)) continue;
      if (CONTROL_LANE.test(line)) { controlLane++; continue; }
      conditional++;

      // A module the reason calls unimplemented, which now has a tsconfig of its own.
      // The owning module is excluded: a reason may name its own module for other reasons.
      const claimed = new Set();
      for (const pattern of UNIMPLEMENTED) {
        pattern.lastIndex = 0;
        for (const match of line.matchAll(pattern)) claimed.add(match[1]);
      }
      const built = [...claimed].filter((n) => n !== entry.name && MODULES.has(n));
      if (built.length > 0) {
        staleModules++;
        console.log(`  STALE MODULE  ${entry.name}/${name}: ${line.split(":")[0]}`);
        console.log(`         reason calls ${built.join(", ")} unimplemented; runtime/node has it`);
      }

      if (published === null) continue;
      const named = [...line.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((m) => m[1]);
      const present = named.filter((n) => published.has(n));
      if (present.length === 0) continue;
      stale++;
      console.log(`  STALE  ${entry.name}/${name}: ${line.split(":")[0]}`);
      console.log(`         reason cites ${present.join(", ")} as absent; the addon publishes it`);
    }
  }
}

console.log(
  `\n  ${listsRead} list(s) read across ${MODULES.size} module(s); ${listsWithoutAddon} module(s) had no` +
  " addon, so their export check was skipped and their module check was not.",
);
console.log(
  `  ${conditional} exclusion(s) conditional on an absence: ${stale} whose named export is now` +
  ` published, ${staleModules} whose named module is now implemented.`,
);
console.log(
  `  ${controlLane} more name an absence the control lane creates on purpose, which is true` +
  " whatever the build publishes; those are skipped rather than dropped, because a reason" +
  "\n  mentioning sabotage *and* a real absence would hide behind the same words.",
);
process.exit(stale === 0 ? 0 : 1);
