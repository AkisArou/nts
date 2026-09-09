// Fixture expectations that name text the emitter writes unconditionally.
//
//   node tooling/conformance/unconditional-expectations.mjs
//   NTS_BIN=<a pinned copy> node tooling/conformance/unconditional-expectations.mjs
//
// # The flaw this looks for
//
// `rest-element-error-replaces-the-modules-own` was filed expecting
// `emits-addon could not gather the rest arguments`. That string is
// `nts_napi_check`'s **fallback message**, written into every emitted addon
// whether anything reaches it or not. Counted across the fix that closed the
// defect it named:
//
//     as filed     1 occurrence before, 2 after     -- present on both sides
//     repaired     0 occurrences before, 1 after    -- distinguishes
//
// So the fixture would have reported `reproduces` forever. The compiler lane hit
// the same shape from the other side: a guard expecting
// `the compiled function requires 1 argument` while the old compiler emitted
// `requires 1 arguments`, so the expectation was a *substring* of the wrong
// output.
//
// **The text a fixture names must be text the fix changes.** Error strings are
// the most tempting candidate and the worst one: written once into every
// artifact and reached rarely, so identical whether the defect is present or
// not.
//
// # How this decides it
//
// Emit an addon for a program with **nothing in common with any fixture** -- one
// function adding two numbers -- and check whether each fixture's expected text
// appears in it. If it does, the emitter writes that text regardless, and the
// expectation cannot distinguish a fixed compiler from a broken one.
//
// Controlled against the flaw it was written for. In an addon emitted for
// `add(a: number, b: number)` -- no rest parameter anywhere:
//
//     "could not gather the rest arguments"        1 occurrence   (as filed -> flagged)
//     nts_napi_rest(env, info, 0, true, "args"     0 occurrences  (repaired -> not flagged)
//
// So this would have caught it at filing time, which is the only time it is
// cheap to catch.
//
// # What a hit means, and what it does not
//
// A hit is a question, not a verdict. `closure-call-slot` expects
// `emits-c const uint32_t nts_closure_call_slot` and that symbol *is* emitted
// unconditionally -- deliberately, so a program with no closures still links --
// and the fixture says so: "the guard is on the symbol being emitted, not on its
// value". Its unconditionality is the property under guard. That is a correct
// fixture and this check flags it, which is the right trade: the flag costs a
// reading, and the flaw it catches costs a fixture that can never fail.

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

/* Emitted trees under one root, removed when the run ends.
 *
 * Temp directories created per case and never removed filled a 16G `/tmp`
 * across a day of runs. The failure does not look like a disk error: `emit-c`
 * has nowhere to write, every case reports a refusal it did not have, and a
 * failed emit reads exactly like a real regression. `NTS_KEEP_TEMP=1` keeps the
 * tree for anyone reducing a case by hand. */
const RUN_ROOT = mkdtempSync(join(tmpdir(), "nts-unconditionalexpectations-"));
const workspace = (prefix) => mkdtempSync(join(RUN_ROOT, prefix));
process.on("exit", () => {
  if (process.env.NTS_KEEP_TEMP === undefined) {
    try { rmSync(RUN_ROOT, { recursive: true, force: true }); } catch { /* going away anyway */ }
  } else {
    console.log(`  kept ${RUN_ROOT}`);
  }
});


const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const compiler = process.env.NTS_BIN ?? process.env.NTS_COMPILER ?? join(ROOT, "target/release/nts");

if (!existsSync(compiler)) {
  console.error(`no compiler at ${compiler}`);
  process.exit(2);
}

// A program sharing nothing with any fixture: no class, no closure, no rest
// parameter, no unrepresentable type, one scalar function.
const work = workspace("nts-unconditional-");
mkdirSync(join(work, "src"), { recursive: true });
writeFileSync(
  join(work, "tsconfig.json"),
  JSON.stringify({
    extends: join(ROOT, "tooling/conformance/blockers/tsconfig.base.json"),
    compilerOptions: { rootDir: "." },
  }, null, 2),
);
writeFileSync(
  join(work, "src/main.ts"),
  "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
);

const run = spawnSync(
  compiler,
  ["emit-c", join(work, "tsconfig.json"), "--out", join(work, "out"), "--napi"],
  { encoding: "utf8", env: { ...process.env, NTS_TSGO: join(ROOT, "target/tsgo") } },
);
if (run.status !== 0 && !existsSync(join(work, "out/addon.c"))) {
  console.error(`the control program did not emit: ${(run.stdout ?? "") + (run.stderr ?? "")}`.slice(0, 400));
  process.exit(3);
}

let blob = "";
for (const f of ["addon.c", "program.c"]) {
  const p = join(work, "out", f);
  if (existsSync(p)) blob += readFileSync(p, "utf8");
}

const fixtures = join(ROOT, "tooling/conformance/blockers");
const flagged = [];
let checked = 0;
for (const d of readdirSync(fixtures).sort()) {
  const src = join(fixtures, d, "src", "main.ts");
  if (!existsSync(src)) continue;
  const first = readFileSync(src, "utf8").split("\n")[0].trim();
  const m = /^\/\/\s*expect:\s*(?:emit-c[^>]*->\s*)?(emits-c|emits-addon)\s+(.+)$/.exec(first);
  if (m === null) continue;
  checked += 1;
  const text = m[2].trim();
  if (text !== "" && blob.includes(text)) flagged.push({ name: d, kind: m[1], text });
}

console.log(`${checked} fixture(s) name emitted text; ${flagged.length} of them name text the emitter writes anyway.\n`);
for (const f of flagged) {
  console.log(`  UNCONDITIONAL  ${f.name}`);
  console.log(`                 ${f.kind} ${f.text.slice(0, 90)}`);
  console.log(`                 read it: if the unconditionality is the property under guard this is correct,`);
  console.log(`                 and if it is not, the fixture cannot fail.`);
}
if (flagged.length === 0) {
  console.log("  Every named text is absent from a program that shares nothing with any fixture.");
}
