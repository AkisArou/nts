// An outcomes fixture as a compilable project: the one definition of how
// `tooling/conformance/outcomes/<name>` becomes something `nts` can read.
//
// Shared by `outcomes-check.mjs`, which builds and runs it, and
// `integrity.mjs`, which reads its listings. A fixture's `main.ts` calls
// `observe` and `done` from `outcomes-harness.ts` and does not typecheck
// without it, so two tools deriving the project separately would be two
// derivations of the program the fixture means -- the kind that drift.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
export const OUTCOMES = join(HERE, "outcomes");
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
    `${JSON.stringify({ extends: join(ROOT, "tsconfig.fixtures.json"), include: ["src"] }, null, 2)}\n`,
  );
  if (mode === "build") {
    const main = join(dir, "src/main.ts");
    writeFileSync(main, `${HARNESS}\n${readFileSync(main, "utf8")}`);
  }
  return dir;
}
