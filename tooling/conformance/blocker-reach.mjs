// Which refusal blocks how many modules, counted rather than guessed.
//
//   NTS_COMPILER=<pinned> node tooling/conformance/blocker-reach.mjs
//
// The compiled axis is blocked by compiler refusals, and the queue between them
// has been ordered by argument. This orders it by *reach*: for every module, run
// `hir`, collect the refusals, normalise each to its shape, and count how many
// distinct modules each shape stops.
//
// **It measures lowering *roots* only, unless you ask for more.** Plain `hir`
// emits `NTS1001` and **no `NTS1003` at all** -- the cascade needs `--prepared`,
// and on `http` that is 0 against 893. This header used to say `hir` emits both,
// which was wrong; the numbers were right, because a root is the thing to fix and
// a cascade is its consequence, but the sentence claimed a coverage the tool did
// not have.
//
// Roots are the correct unit here for a reason worth stating: a root in
// `internal/errors.ts` is compiled into every module's cone, so it appears in
// every module's `hir` output and its reach is counted properly without the
// cascade. Adding `--prepared` would fill the table with derived shapes that
// clear themselves when their root does.
//
// The backend codes -- `NTS2006`, `NTS2008`, `NTS2009` -- come from `emit-c` and
// this tool never saw one. That was a hole rather than
// a decision: the table read as a complete picture of what blocks the compiled
// axis while saying nothing about 253 `NTS2006` in the same corpus, and it was
// found only because another lane asked what they were. Pass `--backend` to run
// `emit-c` as well; it is slower by roughly an order of magnitude, which is why
// it is a flag rather than the default.
//
// Two cautions the numbers do not carry, so they are said here:
//
//   Reach is not cost. A shape that blocks twelve modules may be a
//   representation decision worth a week -- `computed-member-write` is exactly
//   that -- and one that blocks two may be an afternoon. Cost-if-unfixed is not
//   value-per-hour, which is a mistake this lane has already made once and
//   written down in that fixture.
//
//   A module is "blocked" here if the shape appears anywhere in its refusals,
//   including in code it merely imports. `runtime/node/internal/errors.ts` is
//   reached by everything, so a refusal there reaches everything, and that is
//   a true statement about the front door rather than about each module.
//
// Refusals inside a module's own source are counted separately from ones it
// only inherits, because the two are different work.

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const compiler = process.env.NTS_COMPILER ?? process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
if (!existsSync(compiler)) {
  console.error(`no compiler at ${compiler}`);
  process.exit(2);
}

const BACKEND = process.argv.includes("--backend");

const modules = readdirSync(join(ROOT, "runtime/node"), { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== "node_modules" && e.name !== "internal")
  .map((e) => e.name)
  .filter((name) => existsSync(join(ROOT, "runtime/node", name, "tsconfig.json")))
  .sort();

/** The refusal's shape: the message with its backticked identifiers removed. */
function shapeOf(message) {
  return message
    .replace(/`[^`]*`/g, "X")
    .replace(/\s+is not supported by this lowering yet\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const reach = new Map();   // shape -> { own: Set, inherited: Set }
for (const module of modules) {
  const tsconfig = join(ROOT, "runtime/node", module, "tsconfig.json");
  const env = { NTS_TSGO: join(ROOT, "target/tsgo"), ...process.env };
  const runs = [spawnSync(compiler, ["hir", tsconfig], {
    encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 600_000, env,
  })];
  if (BACKEND) {
    const out = mkdtempSync(join(tmpdir(), "nts-reach-"));
    runs.push(spawnSync(compiler, ["emit-c", tsconfig, "--out", out, "--napi"], {
      encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 900_000, env,
    }));
    rmSync(out, { recursive: true, force: true });
  }
  const text = runs.map((r) => `${r.stdout ?? ""}\n${r.stderr ?? ""}`).join("\n");
  for (const line of text.split("\n")) {
    // A backend line is `file:line:col: NTS2xxx message` -- note the colon
    // *after* the column, which the lowering lines do not have. Matched
    // separately rather than by loosening the lowering pattern, because the two
    // formats differing by one character is exactly how a loosened pattern
    // starts quietly matching the wrong thing.
    const backend = BACKEND ? /(\S+):\d+:\d+: (NTS2\d{3}) (.+)$/.exec(line) : null;
    if (backend !== null) {
      const [, file, code, message] = backend;
      const shape = `${code} ${shapeOf(message)}`;
      if (!reach.has(shape)) reach.set(shape, { own: new Set(), inherited: new Set() });
      const entry = reach.get(shape);
      // Most backend diagnostics point at `web-platform`, which every module
      // imports. Counting those as the module's *own* would put a shared
      // refusal in the column that is supposed to mean "in this module's
      // source", which is the column worth sorting by.
      if (file.includes(`/node/${module}/`)) entry.own.add(module);
      else entry.inherited.add(module);
      continue;
    }
    const m = /(\S+):\d+:\d+ NTS100[13] (.+)$/.exec(line);
    if (m === null) continue;
    const [, file, message] = m;
    const shape = shapeOf(message);
    if (!reach.has(shape)) reach.set(shape, { own: new Set(), inherited: new Set() });
    const entry = reach.get(shape);
    if (file.includes(`/node/${module}/`)) entry.own.add(module);
    else entry.inherited.add(module);
  }
  process.stderr.write(`  ${module}\n`);
}

const rows = [...reach].map(([shape, { own, inherited }]) => ({
  shape,
  own: own.size,
  total: new Set([...own, ...inherited]).size,
})).sort((a, b) => b.total - a.total || b.own - a.own);

// A corpus of twenty-two node modules has never emitted without a diagnostic, so
// zero is the instrument failing rather than the tree improving. The most likely
// cause is `NTS_TSGO` unset, which makes the frontend fail on every module and
// produces a perfect, meaningless zero.
if (rows.length === 0) {
  console.error(
    "  INSTRUMENT FAILURE: zero refusal shapes across " + modules.length +
      " modules.\n  This corpus has never emitted without a diagnostic. Check that " +
      "NTS_TSGO points\n  at a real tsgo -- an unset one fails the frontend on every " +
      "module and reads as a\n  clean sweep.",
  );
  process.exitCode = 2;
}

console.log(`\n  ${rows.length} distinct refusal shape(s) across ${modules.length} modules`);
console.log(`  ${"reach".padStart(5)} ${"own".padStart(4)}  shape`);
const print = (row) =>
  console.log(`  ${String(row.total).padStart(5)} ${String(row.own).padStart(4)}  ${row.shape.slice(0, 88)}`);
const top = rows.slice(0, 30);
for (const row of top) print(row);

// Every backend shape, regardless of rank. They are far down the reach column --
// a backend refusal stops one module where a shared lowering refusal stops
// twenty-one -- so a top-N cut hides all of them, which is the state this tool
// was in until another lane asked what its 253 `NTS2006` were. Printing them
// unconditionally is the whole reason `--backend` exists.
if (BACKEND) {
  const backendRows = rows.filter((r) => /^NTS2\d{3} /.test(r.shape) && !top.includes(r));
  if (backendRows.length > 0) {
    console.log(`\n  backend shapes below the cut:`);
    for (const row of backendRows) print(row);
  }
}
