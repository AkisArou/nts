// The scratch project a Test262 file is compiled in, in one place.
//
// Two instruments need it — `test262.mjs`, which compiles and records why a
// file is refused, and `run262.mjs`, which builds and runs one. If each
// materialised its own project they would be two derivations of one fact, and
// the first time they disagreed the census and the run would be measuring
// different programs while reporting the same corpus.

import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The lowerable stand-in for the harness entries every non-raw test receives. */
export const HARNESS = readFileSync(join(HERE, "harness.ts"), "utf8");

/** `assert.throws`, spliced in only for a test that calls it; the file says why. */
export const HARNESS_THROWS = readFileSync(join(HERE, "harness-throws.ts"), "utf8");

/** `$DONOTEVALUATE`, spliced in only for a test that names it; the file says why. */
export const HARNESS_DONOTEVALUATE = readFileSync(join(HERE, "harness-donotevaluate.ts"), "utf8");

/**
 * The stand-in one test receives: `HARNESS`, plus `throws` if the test calls it,
 * plus `$DONOTEVALUATE` if it names it. Per test, as test262 includes harness
 * files per test -- a member that refuses must not reach a test that does not
 * use it (`harness-throws.ts` records what that cost).
 */
export function harnessFor(body) {
  let harness = HARNESS;
  if (/\bassert\.throws\s*\(/.test(body)) {
    const opening = "namespace assert {\n";
    if (!harness.includes(opening)) throw new Error("harness.ts has no `namespace assert {` line to splice throws into");
    harness = harness.replace(opening, opening + HARNESS_THROWS);
  }
  if (/\$DONOTEVALUATE\b/.test(body)) harness = harness + HARNESS_DONOTEVALUATE;
  return harness;
}

/**
 * A scratch project, with its compiler options **inlined**.
 *
 * Not `extends`-ed: a copied fixture config's relative `extends` resolves to
 * nothing, silently, and the options vanish — which has already cost this
 * repository a probe that measured a different language than it meant to.
 */
export function workspace(dir) {
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
 * One test, as a single script.
 *
 * The harness is **prepended, not imported**. An `import` would make the unit a
 * module, which changes top-level `var` scoping and `this`;
 * `docs/conformance/test262.md` is explicit that the units "must not be
 * concatenated into a function or CommonJS wrapper: that changes global script
 * semantics, strict-directive reach, parse phases, and declaration visibility".
 * Prepending sibling top-level statements is none of those.
 */
export function materialise(dir, body) {
  const source = `"use strict";\n${harnessFor(body)}${body}`;
  writeFileSync(join(dir, "src", "main.ts"), source);
  return source;
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
