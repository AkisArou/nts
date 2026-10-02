// The scratch project a Test262 file is compiled in, in one place.
//
// Two instruments need it — `test262.ts`, which compiles and records why a
// file is refused, and `run262.ts`, which builds and runs one. If each
// materialised its own project they would be two derivations of one fact, and
// the first time they disagreed the census and the run would be measuring
// different programs while reporting the same corpus.

import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The lowerable stand-in for the harness entries every non-raw test receives. */
export const HARNESS = readFileSync(join(HERE, "harness.ts"), "utf8");

/**
 * Top-level entries appended only for a test that names them, as test262
 * includes `doneprintHandle.js` only for an `async` test: `$DONOTEVALUATE`
 * (`sta.js`) and `$DONE` (`doneprintHandle.js`). Each file says why.
 */
const GLOBALS = [
  { names: /\$DONOTEVALUATE\b/, source: readFileSync(join(HERE, "harness-donotevaluate.ts"), "utf8") },
  { names: /\$DONE\b/, source: readFileSync(join(HERE, "harness-done.ts"), "utf8") },
];

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
 * The `includes:` files the stand-in answers for, so they are not compiled
 * from test262's own source. `compareArray.js` is empty upstream -- its entry
 * moved into `assert.js` -- so it asks for nothing `MEMBERS` lacks. Every
 * other include is compiled as test262 wrote it (`materialise`).
 */
export const PROVIDED_INCLUDES = new Set(["compareArray.js"]);

/** Where test262's own harness files are, read verbatim for a test's `includes:`. */
const SUITE_HARNESS = join(HERE, "../../third_party/test262/harness");

/** A test's own includes are compiled beside it as `src/include-<name>`: before `main.js` in file order, after the stand-in. */
const INCLUDE_PREFIX = "src/include-";

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
const LAYOUT = `${HARNESS_FILE} + ${INCLUDE_PREFIX}*.js verbatim + ${TEST_FILE} (allowJs, checkJs unset), test prelude ${JSON.stringify(TEST_PRELUDE)}, ./*_FIXTURE.js modules beside it and outside the roots, each a module`;
export const HARNESS_HASH = [LAYOUT, HARNESS, ...GLOBALS.map((g) => g.source), ...MEMBERS.map((m) => m.source)]
  .reduce((hash, source) => hash.update(source), createHash("sha256"))
  .digest("hex")
  .slice(0, 16);

/** The stand-in one test receives: `HARNESS`, the members it calls, and `$DONOTEVALUATE` if it names it. */
export function harnessFor(body) {
  const opening = "namespace assert {\n";
  if (!HARNESS.includes(opening)) throw new Error("harness.ts has no `namespace assert {` line to splice members into");
  const members = MEMBERS.filter((m) => m.calls.test(body)).map((m) => m.source).join("");
  const globals = GLOBALS.filter((g) => g.names.test(body)).map((g) => g.source).join("");
  return HARNESS.replace(opening, opening + members) + globals;
}

/** A test262 file's front matter, which the body a case compiles leaves out. */
export const FRONTMATTER = /\/\*---([\s\S]*?)---\*\//;

/**
 * A test262 file's `flags:`, flow-style (`flags: [async]`) or a block list
 * (`flags:\n  - async`), as the metadata parser reads both.
 */
export function flagsOf(source) {
  const meta = FRONTMATTER.exec(source)?.[1] ?? "";
  const flow = /^\s*flags:\s*\[([^\]]*)\]/m.exec(meta);
  if (flow) return flow[1].split(",").map((f) => f.trim()).filter(Boolean);
  const block = /^\s*flags:\s*\n((?:\s*-\s*\S+\s*\n?)+)/m.exec(meta);
  return block ? [...block[1].matchAll(/-\s*(\S+)/g)].map((m) => m[1]) : [];
}

/** A test262 file's `includes:`, flow-style or a block list, as `flagsOf` reads flags. */
export function includesOf(source) {
  const meta = FRONTMATTER.exec(source)?.[1] ?? "";
  const flow = /^\s*includes:\s*\[([^\]]*)\]/m.exec(meta);
  if (flow) return flow[1].split(",").map((f) => f.trim()).filter(Boolean);
  const block = /^\s*includes:\s*\n((?:\s*-\s*\S+\s*\n?)+)/m.exec(meta);
  return block ? [...block[1].matchAll(/-\s*(\S+)/g)].map((m) => m[1]) : [];
}

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
        // **The roots are the harness, its includes and the test -- not every
        // file under src/.** A test's `_FIXTURE.js` modules are written beside
        // it and enter the program only by being imported, as test262 has it:
        // a fixture is a module the test loads, and one listed as a root would
        // be evaluated whether or not anything loads it, so "evaluated lazily,
        // once" could not be seen, and a test checking a fixture has not run
        // yet would pass for the wrong reason.
        include: [HARNESS_FILE, `${INCLUDE_PREFIX}*`, TEST_FILE],
      },
      null,
      2,
    )}\n`,
  );
  return dir;
}

/**
 * One test, as global scripts: the stand-in in `HARNESS_FILE`, typed
 * TypeScript; each of the test's `includes:` as test262 wrote it, in
 * `src/include-<name>`; and the test in `TEST_FILE`, JavaScript as test262
 * wrote it. `body` is the file as read, front matter and all, which is where
 * its includes are named.
 *
 * Separate source units in one realm is test262's own model -- harness files
 * and the test "remain separate source units evaluated in one realm"
 * (`docs/conformance/test262.md`). None imports another: an `import` would
 * make them modules, which changes top-level `var` scoping and `this`. Each
 * carries the strict directive. An include is compiled verbatim rather than
 * stood in for: a stand-in is a second derivation of the harness, and an
 * include nts cannot compile then refuses, named and ranked, instead of
 * holding its test out of the census. Scripts run in file order, so an
 * include's top-level statements (`tcoHelper.js`'s `$MAX_ITERATIONS`) are
 * done before the test's first line.
 */
export function materialise(dir, body, origin?) {
  const src = join(dir, "src");
  for (const stale of readdirSync(src).filter((f) => `src/${f}`.startsWith(INCLUDE_PREFIX))) rmSync(join(src, stale));
  for (const stale of readdirSync(src, { recursive: true }).map(String).filter((f) => f.endsWith("_FIXTURE.js"))) rmSync(join(src, stale), { force: true });
  if (origin) {
    for (const [relative, source] of fixturesOf(origin, body)) {
      mkdirSync(dirname(join(src, relative)), { recursive: true });
      writeFileSync(join(src, relative), asModule(source));
    }
  }
  writeFileSync(join(dir, HARNESS_FILE), `"use strict";\n${harnessFor(body)}`);
  for (const include of includesOf(body).filter((name) => !PROVIDED_INCLUDES.has(name))) {
    writeFileSync(join(dir, `${INCLUDE_PREFIX}${include}`), `"use strict";\n${bodyOf(readFileSync(join(SUITE_HARNESS, include), "utf8"))}`);
  }
  writeFileSync(join(dir, TEST_FILE), `${TEST_PRELUDE}${body}`);
}

/**
 * **A fixture is a module, whatever it contains.** test262 loads every
 * `_FIXTURE.js` as a module (INTERPRETING.md), but TypeScript decides from the
 * text: a file with no top-level `import` or `export` is a *script*, and a
 * script is no `import()` target. On 2026-10-02, 48 dynamic-import tests named
 * `./empty_FIXTURE.js` -- comments only -- and read "a dynamic `import()` of a
 * module this program does not contain". So such a fixture gets `export {};`
 * appended: the same program as a module, with no binding added. Not
 * `moduleDetection: "force"`, which would make the harness and the test
 * modules too, and change their script semantics.
 */
function asModule(source) {
  return /^\s*(import|export)\b/m.test(source) ? source : `${source}\nexport {};\n`;
}

/** A `./..._FIXTURE.js` specifier in a test or a fixture. */
const FIXTURE_REFERENCE = /(["'])(\.\/[^"'\n]*_FIXTURE\.js)\1/g;

/**
 * The fixture modules a test names, **transitively**, as relative path ->
 * source, the path relative to the test's own directory. test262 writes every
 * one `./`-relative (1,335 references, none `../`), and 120 of the dynamic-
 * import fixtures import another fixture, so a test's program is the closure,
 * not its own references. A reference whose file does not exist is left to
 * the compiler to report, as it would be for any program.
 */
export function fixturesOf(origin, body) {
  const found = new Map();
  const visit = (text, from) => {
    for (const m of text.matchAll(FIXTURE_REFERENCE)) {
      const relative = normalize(join(from, m[2]));
      if (relative.startsWith("..") || found.has(relative)) continue;
      const file = join(dirname(origin), relative);
      if (!existsSync(file)) continue;
      const source = readFileSync(file, "utf8");
      found.set(relative, source);
      visit(source, dirname(relative));
    }
  };
  visit(body, ".");
  return found;
}

/**
 * Where a diagnostic at `file:line` is: in the test (`line` then counted from
 * the test's own first line), in the stand-in, or elsewhere. One definition,
 * for every instrument that ranks causes: a cause in the stand-in is ours, and
 * ranked as the test's it would top every table.
 */
export function placeOf(file, line) {
  if (file.endsWith(TEST_FILE)) return { where: "body", line: line - TEST_PRELUDE.split("\n").length + 1 };
  if (file.endsWith(HARNESS_FILE) || file.includes(INCLUDE_PREFIX)) return { where: "harness" };
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
