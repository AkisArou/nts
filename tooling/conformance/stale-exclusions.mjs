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
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ABSENCE = /absent|not published|missing|does not publish/i;

let conditional = 0;
let stale = 0;
for (const entry of readdirSync(resolve(ROOT, "runtime/node"), { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "node_modules") continue;
  const list = resolve(ROOT, "runtime/node", entry.name, "not-applicable");
  if (!existsSync(list)) continue;

  let published = new Set();
  try {
    const addon = require(resolve(ROOT, "target/node", `${entry.name}.node`));
    published = new Set(Object.keys(addon).filter((k) => addon[k] !== undefined));
  } catch {
    // No addon yet: nothing it names can have become present.
    continue;
  }

  for (const line of readFileSync(list, "utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (!ABSENCE.test(line)) continue;
    conditional++;
    const named = [...line.matchAll(/`([A-Za-z_$][\w$]*)`/g)].map((m) => m[1]);
    const present = named.filter((n) => published.has(n));
    if (present.length === 0) continue;
    stale++;
    console.log(`  STALE  ${entry.name}/${line.split(":")[0]}`);
    console.log(`         reason cites ${present.join(", ")} as absent; the addon publishes it`);
  }
}

console.log(
  `\n  ${conditional} exclusion(s) conditional on an absence, ${stale} whose named export is now published.`,
);
process.exit(stale === 0 ? 0 : 1);
