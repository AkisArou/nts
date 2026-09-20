// Every `tsconfig.json` in this repository, checked for one thing: that its
// `extends` names a file that exists.
//
//   node tooling/conformance/fixture-configs.mjs
//
// **A tsconfig whose `extends` resolves to nothing is not an error anywhere.**
// TypeScript reports it, tsgo carries on, and `nts` never sees it -- so the
// fixture compiles under whatever the defaults are instead of under the config
// its directory says it uses. Nothing in the gate could tell the difference,
// because every downstream step reads the *result* of compiling and the result
// is a perfectly good program.
//
// Found 2026-09-20 with 18 live instances: 13 examples pointing five levels up
// at `/home/tsconfig.fixtures.json`, and 5 blockers that meant
// `../../../../tsconfig.fixtures.json` and wrote three or two dots' worth. The
// examples came from copying a neighbour's config as a template -- the earliest
// is 2026-09-05, so the broken template was copied for two weeks.
//
// **What it cost, measured rather than assumed: nothing.** The prepared HIR is
// byte-identical for all 13 examples under the real config and under none, and
// `blockers-check` returns the same 190 verdicts before and after. A missing
// `extends` target does not fall back to loose defaults the way it first looked
// like it would -- an explicit `"strict": false` lowers `x: number | undefined`
// to `f64`, and a *broken* extends still lowers it to `erased` with a tag check,
// the same as the real config. So this guard is here for the next one, not for
// these: the failure mode is silent and the blast radius is a whole config.
//
// Not checked here, on purpose: whether the file it resolves to is the *right*
// base. `blockers/tsconfig.base.json` reaches the root config that sets
// `erasableSyntaxOnly`, and its own comment explains at length why a fixture
// using `enum` or `namespace` must extend `tsconfig.fixtures.json` instead.
// That is a judgement about the fixture's content; this is a spelling check.

import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

/* `git ls-files` rather than a walk: it is the repository's own answer to
 * "which files are ours", so a vendored tree, a build directory and anything
 * ignored are all excluded by the same rule instead of by a list of paths that
 * would go stale. `target-config/tmp` held three generated configs whose
 * `extends` is an absolute path -- correct, and not ours to check.
 *
 * **`--others --exclude-standard` is not optional**, and the first sabotage of
 * this file is why. Written with plain `ls-files`, it scored 0 broken while an
 * uncommitted example carried the exact five-dots defect this exists to find --
 * because the example was untracked. A copied-template mistake is *always*
 * untracked at the moment it is made, so tracked-only is blind for precisely
 * the window in which a person could still be told. */
const configs = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "*tsconfig.json", "*tsconfig.*.json"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .filter((p) => !p.startsWith("third_party/"));

/* `extends` may be a string or, since TypeScript 5.0, an array. A bare
 * specifier (`@tsconfig/node20/tsconfig.json`) resolves through node_modules
 * and is reported separately rather than as broken: this repository has none
 * today, and guessing at module resolution here would be a second derivation of
 * something node already knows. */
const relativeish = (s) => s.startsWith(".") || isAbsolute(s);

const broken = [];
const packages = [];
let checked = 0;

for (const rel of configs) {
  const file = join(ROOT, rel);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  /* A tsconfig is JSON with comments in practice -- this repository writes `//`
   * keys rather than comment syntax, but stripping trailing commas and line
   * comments costs two lines and removes a class of false alarm. */
  const stripped = text.replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1");
  let parsed;
  try {
    parsed = JSON.parse(stripped);
  } catch (error) {
    broken.push({ rel, target: "(unparseable)", why: String(error.message).slice(0, 80) });
    continue;
  }
  const extendsField = parsed.extends;
  if (extendsField === undefined) continue;
  for (const target of Array.isArray(extendsField) ? extendsField : [extendsField]) {
    checked += 1;
    if (!relativeish(target)) {
      packages.push({ rel, target });
      continue;
    }
    const at = isAbsolute(target) ? target : resolve(dirname(file), target);
    /* TypeScript appends `.json` when the target has no extension. */
    if (existsSync(at) || existsSync(`${at}.json`)) continue;
    broken.push({ rel, target, why: "no such file" });
  }
}

for (const { rel, target, why } of broken) {
  console.log(`  BROKEN   ${rel}`);
  console.log(`           extends ${target} -- ${why}`);
}
for (const { rel, target } of packages) {
  console.log(`  package  ${rel} extends ${target} (not checked here)`);
}
console.log(
  `\n  ${configs.length} tsconfig(s), ${checked} extends clause(s), ${broken.length} that resolve to nothing`,
);
process.exitCode = broken.length === 0 ? 0 : 1;
