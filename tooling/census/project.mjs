// The scratch project a Test262 file is compiled in, in one place.
//
// Two instruments need it — `test262.mjs`, which compiles and records why a
// file is refused, and `run262.mjs`, which builds and runs one. If each
// materialised its own project they would be two derivations of one fact, and
// the first time they disagreed the census and the run would be measuring
// different programs while reporting the same corpus.

import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The lowerable stand-in for the harness entries every non-raw test receives. */
export const HARNESS = readFileSync(join(HERE, "harness.ts"), "utf8");

/** `$DONOTEVALUATE`, spliced in only for a test that names it; the file says why. */
export const HARNESS_DONOTEVALUATE = readFileSync(join(HERE, "harness-donotevaluate.ts"), "utf8");

/**
 * Members of `namespace assert` spliced in only for a test that calls them,
 * as test262 includes harness files per test: a member that refuses must not
 * reach a test that does not use it (`harness-throws.ts` records what that
 * cost). Each file says why it is one.
 */
const MEMBERS = [
  { calls: /\bassert\.throws\s*\(/, source: readFileSync(join(HERE, "harness-throws.ts"), "utf8") },
  { calls: /\bassert\.compareArray\s*\(/, source: readFileSync(join(HERE, "harness-compare-array.ts"), "utf8") },
];

/**
 * The `includes:` files this stand-in provides. Any other include makes a case
 * `unsupported` before it is compiled. `compareArray.js` is empty upstream --
 * its entry moved into `assert.js` -- so it asks for nothing `MEMBERS` lacks.
 */
export const PROVIDED_INCLUDES = new Set(["compareArray.js"]);

/** Where `materialise` puts the stand-in and the test, relative to the workspace. */
export const HARNESS_FILE = "src/harness.ts";
export const TEST_FILE = "src/main.js";

/**
 * What the test file holds before the test's own first line: the strict
 * directive the initial lane injects, one line.
 */
const TEST_PRELUDE = '"use strict";\n';

/**
 * Every source a case's stand-in can be made of, and the layout it is placed
 * in, hashed: a row records it, so rows from two stand-ins -- or from one
 * stand-in laid out two ways -- are two runs even under one compiler. Derived
 * here, beside the list, so a member added is a member hashed.
 */
const LAYOUT = `${HARNESS_FILE} + ${TEST_FILE} (allowJs, checkJs unset), test prelude ${JSON.stringify(TEST_PRELUDE)}`;
export const HARNESS_HASH = [LAYOUT, HARNESS, HARNESS_DONOTEVALUATE, ...MEMBERS.map((m) => m.source)]
  .reduce((hash, source) => hash.update(source), createHash("sha256"))
  .digest("hex")
  .slice(0, 16);

/** The stand-in one test receives: `HARNESS`, the members it calls, and `$DONOTEVALUATE` if it names it. */
export function harnessFor(body) {
  const opening = "namespace assert {\n";
  if (!HARNESS.includes(opening)) throw new Error("harness.ts has no `namespace assert {` line to splice members into");
  const members = MEMBERS.filter((m) => m.calls.test(body)).map((m) => m.source).join("");
  const harness = HARNESS.replace(opening, opening + members);
  return /\$DONOTEVALUATE\b/.test(body) ? harness + HARNESS_DONOTEVALUATE : harness;
}

/** A test262 file's front matter, which the body a case compiles leaves out. */
export const FRONTMATTER = /\/\*---([\s\S]*?)---\*\//;

/** The body of a test262 file: its source without the front matter. */
export const bodyOf = (source) => source.replace(FRONTMATTER, "");

/**
 * A scratch project, with its compiler options **inlined**.
 *
 * Not `extends`-ed: a copied fixture config's relative `extends` resolves to
 * nothing, silently, and the options vanish — which has already cost this
 * repository a probe that measured a different language than it meant to.
 */
export function workspace(dir) {
  // The workspace owns `src/`: a file a previous layout left there -- a
  // `main.ts` beside today's `main.js` -- is compiled with it, and declares
  // every name twice (TS2300).
  rmSync(join(dir, "src"), { recursive: true, force: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          allowImportingTsExtensions: true,
          strict: true,
          noEmit: true,
          // The test is JavaScript, compiled as JavaScript: the checker types
          // it and reports syntax and early errors, not TypeScript's type
          // errors. Its unannotated values reach lowering as `any`, which is
          // `docs/any-unknown.md`'s "implicit values in unannotated JavaScript"
          // -- the population NeedsRepresentation serves. Compiled as `.ts` it
          // was 18,987 checker refusals, 2,818 of them syntax.
          //
          // **`checkJs` is left unset, and unset is not `false`.** TypeScript
          // treats a JavaScript file with no `checkJs` at all as *plain JS* and
          // still reports its early errors -- `let x; let x;` (TS2451), `eval`
          // assigned in strict code (TS1100). An explicit `false` turns those
          // off too: the first run of this layout accepted 2,951 negative-parse
          // tests the checker had rejected, every one a SyntaxError test262
          // requires.
          allowJs: true,
        },
        include: ["src"],
      },
      null,
      2,
    )}\n`,
  );
  return dir;
}

/**
 * One test, as two global scripts: the stand-in in `HARNESS_FILE`, typed
 * TypeScript, and the test in `TEST_FILE`, JavaScript as test262 wrote it.
 *
 * Two source units in one realm is test262's own model -- harness files and
 * the test "remain separate source units evaluated in one realm"
 * (`docs/conformance/test262.md`). Neither imports the other: an `import`
 * would make them modules, which changes top-level `var` scoping and `this`.
 * Both carry the strict directive, as the prepended single script did.
 */
export function materialise(dir, body) {
  writeFileSync(join(dir, HARNESS_FILE), `"use strict";\n${harnessFor(body)}`);
  writeFileSync(join(dir, TEST_FILE), `${TEST_PRELUDE}${body}`);
}

/**
 * Where a diagnostic at `file:line` is: in the test (`line` then counted from
 * the test's own first line), in the stand-in, or elsewhere. One definition,
 * for every instrument that ranks causes: a cause in the stand-in is ours, and
 * ranked as the test's it would top every table.
 */
export function placeOf(file, line) {
  if (file.endsWith(TEST_FILE)) return { where: "body", line: line - TEST_PRELUDE.split("\n").length + 1 };
  if (file.endsWith(HARNESS_FILE)) return { where: "harness" };
  return { where: "other" };
}

/**
 * The compiler, copied into `scratch` so a run measures one binary.
 *
 * Returns `{ path, fingerprint }`: run `path`, report `fingerprint`.
 *
 * A full slice is tens of minutes and `target/release/nts` is the path everyone
 * builds into, so an instrument reading it directly measures whatever binary
 * happened to be there when each file's turn came. A run here was killed after
 * 1742 rows for exactly that -- a `cargo build --release` landed partway
 * through, and the rows before and after it are two different compilers
 * reported as one number.
 *
 * Nothing in the output would have said so. A report names a compiler *path*,
 * and a path stays true while the thing behind it is replaced. The fingerprint
 * is the bytes, which is the part that cannot.
 */
export function pinCompiler(nts, scratch) {
  mkdirSync(scratch, { recursive: true });
  const path = join(scratch, "nts");
  copyFileSync(nts, path);
  chmodSync(path, 0o755);
  return {
    path,
    fingerprint: createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16),
  };
}

/**
 * The environment every compiler invocation needs.
 *
 * `NTS_NO_SNAPSHOT_CACHE=1` because the snapshot cache keys on the tsconfig
 * *path*, and one scratch path carries thousands of different programs.
 * `cache.rs` records what that costs: two projects hashing to one entry, the
 * second handed the first's program, surfacing only because an unrelated check
 * happened to catch it.
 */
export function environment() {
  return { ...process.env, NTS_NO_SNAPSHOT_CACHE: "1" };
}
