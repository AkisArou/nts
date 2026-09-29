// One test262 case, written out as the census compiles it, for a person to
// run nts on by hand.
//
//   node tooling/census/materialise262.ts <test/...js> <dir>
//
// Writes <dir>/tsconfig.json and <dir>/src/ -- the stand-in harness, each
// include verbatim, the test as `src/main.js` -- through `project.ts`'s own
// `workspace` and `materialise`, and prints the `emit-c` line that
// `attempt262.ts` runs on it.
//
// # Why
//
// A reduction written in `.ts` is a different program from the census case:
// typed parameters, no `assert` inside a generator body, no harness. On
// 2026-09-29 three reconstructions of a failing `private-gen-meth-*` case all
// agreed with node, and three `vN undeclared` cases reduced to programs that
// compiled. The defect was in what the materialised JavaScript carries, and
// only this layout reaches it. A second copy of the layout would be a second
// derivation of it, so this calls the census's functions and nothing else.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { materialise, workspace } from "./project.ts";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const [test, out] = process.argv.slice(2);
if (!test || !out) {
  console.log("  usage: materialise262.ts <test/...js> <dir>");
  process.exit(2);
}
const file = join(ROOT, "third_party/test262", test);
if (!existsSync(file)) {
  console.log(`  no such case: ${file}`);
  process.exit(2);
}
const dir = resolve(out);
mkdirSync(dir, { recursive: true });
workspace(dir);
materialise(dir, readFileSync(file, "utf8"));
console.log(`  ${test} -> ${dir}`);
console.log(`  nts emit-c ${join(dir, "tsconfig.json")} --out ${join(dir, "out")} --main`);
