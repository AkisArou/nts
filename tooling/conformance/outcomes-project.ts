// An outcomes fixture as a compilable project: the one definition of how
// `tooling/conformance/outcomes/<name>` becomes something `nts` can read.
//
// Shared by `outcomes-check.ts`, which builds and runs it, and
// `integrity.ts`, which reads its listings. A fixture's `main.ts` calls
// `observe` and `done` from `outcomes-harness.ts` and does not typecheck
// without it, so two tools deriving the project separately would be two
// derivations of the program the fixture means -- the kind that drift.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
export const OUTCOMES = join(HERE, "outcomes");

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

/** Every fixture's name, sorted. */
export const outcomeFixtures = () =>
  existsSync(OUTCOMES)
    ? readdirSync(OUTCOMES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    : [];

/** `check` when the fixture's main.ts says `// run: check`, else `build`. */
export const runMode = (name) =>
  /^\/\/\s*run:\s*check\b/m.test(readFileSync(join(OUTCOMES, name, "src/main.ts"), "utf8")) ? "check" : "build";

/**
 * The fixture's sources, copied under `scratch/<name>`, with the harness
 * prepended to `main.ts` in build mode, and a tsconfig whose `extends` is
 * **absolute**: a copied relative `extends` resolves to nothing, silently,
 * and the options vanish.
 */
export function materialise(scratch, name, sources, mode) {
  const dir = join(scratch, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(sources, join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "tsconfig.json"),
    `${JSON.stringify({
      extends: join(ROOT, "tsconfig.fixtures.json"),
      compilerOptions: { paths: { [`${RUNTIME_SPECIFIER}*`]: [`${RUNTIME_ROOT}/*`] } },
      include: ["src"],
    }, null, 2)}\n`,
  );
  if (mode === "build") {
    const main = join(dir, "src/main.ts");
    writeFileSync(main, `${HARNESS}\n${readFileSync(main, "utf8")}`);
  }
  return dir;
}
