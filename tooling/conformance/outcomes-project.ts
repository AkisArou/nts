// An outcomes fixture as a compilable project: the one definition of how
// `tests/outcomes/<name>` becomes something `nts` can read.
//
// Shared by `outcomes-check.ts`, which builds and runs it, and
// `integrity.ts`, which reads its listings. A fixture's `main.ts` calls
// `observe` and `done` from `outcomes-harness.ts` and does not typecheck
// without it, so two tools deriving the project separately would be two
// derivations of the program the fixture means -- the kind that drift.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
export const OUTCOMES = join(HERE, "../../tests/outcomes");

/**
 * How a fixture reaches the runtime's own sources: `@nts/runtime/<path>` is
 * `runtime/<path>` in this repository, on both sides -- a tsconfig `paths`
 * entry for nts, and a resolve hook in `outcomes-node-preload.ts` for node.
 * One definition, so the two cannot drift.
 *
 * It exists for guards on runtime *internals*, which no other instrument
 * compares against node: the compiled axis runs a module's own tests, and an
 * internal like `validateObject` is nobody's module. Two such functions gave
 * wrong answers for weeks until 7f7bf5340.
 */
export const RUNTIME_SPECIFIER = "@nts/runtime/";
export const RUNTIME_ROOT = join(ROOT, "runtime");
const HARNESS = readFileSync(join(HERE, "outcomes-harness.ts"), "utf8");

/**
 * Every fixture's name, sorted: the ones git tracks, where this is a checkout.
 * A gate tree reused across commits keeps a fixture directory a later commit
 * does not have -- its ignored node_modules survive the clean -- and reading it
 * failed blockers-check with ENOENT (2026-10-14); this is the same listing.
 */
export const outcomeFixtures = () => {
  if (!existsSync(OUTCOMES)) return [];
  const listed = spawnSync("git", ["ls-files", "-z", "--", "."], { cwd: OUTCOMES, encoding: "utf8" });
  const tracked = listed.status === 0 ? new Set(listed.stdout.split("\0").filter(Boolean).map((p) => p.split("/")[0])) : null;
  return readdirSync(OUTCOMES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && (tracked === null || tracked.has(e.name)))
    .map((e) => e.name)
    .sort();
};

/** `check` when the fixture's main.ts says `// run: check`, else `build`. */
export const runMode = (name) =>
  /^\/\/\s*run:\s*check\b/m.test(readFileSync(join(OUTCOMES, name, "src/main.ts"), "utf8")) ? "check" : "build";

/**
 * The fixture's sources, copied under `scratch/<name>`, with the harness
 * prepended to `main.ts` in build mode, and a tsconfig whose `extends` is
 * **absolute**: a copied relative `extends` resolves to nothing, silently,
 * and the options vanish.
 *
 * The fixture's own `compilerOptions` are kept, `outDir` aside. A defect that
 * needs an option is a different program without it: a stored `null` read
 * under `noUncheckedIndexedAccess` was recorded as agreeing, because this
 * copy wrote its own options and dropped the fixture's.
 */
export function materialise(scratch, name, sources, mode) {
  const dir = join(scratch, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(sources, join(dir, "src"), { recursive: true });
  const config = join(dirname(sources), "tsconfig.json");
  const own = existsSync(config) ? JSON.parse(readFileSync(config, "utf8")).compilerOptions ?? {} : {};
  const { outDir: _outDir, ...options } = own;
  writeFileSync(
    join(dir, "tsconfig.json"),
    `${JSON.stringify({
      extends: join(ROOT, "tsconfig.fixtures.json"),
      compilerOptions: { ...options, paths: { [`${RUNTIME_SPECIFIER}*`]: [`${RUNTIME_ROOT}/*`] } },
      include: ["src"],
    }, null, 2)}\n`,
  );
  if (mode === "build") {
    const main = join(dir, "src/main.ts");
    writeFileSync(main, `${HARNESS}\n${readFileSync(main, "utf8")}`);
  }
  return dir;
}
