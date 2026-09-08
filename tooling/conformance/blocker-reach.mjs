// Which refusal blocks how many modules, counted rather than guessed.
//
//   NTS_COMPILER=<pinned> node tooling/conformance/blocker-reach.mjs
//
// The compiled axis is blocked by compiler refusals, and the queue between them
// has been ordered by argument. This orders it by *reach*: for every module, run
// `hir`, collect the refusals, normalise each to its shape, and count how many
// distinct modules each shape stops.
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

import { existsSync, readdirSync } from "node:fs";
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
  const result = spawnSync(compiler, ["hir", join(ROOT, "runtime/node", module, "tsconfig.json")], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    timeout: 600_000,
    env: { NTS_TSGO: join(ROOT, "target/tsgo"), ...process.env },
  });
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  for (const line of text.split("\n")) {
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

console.log(`\n  ${rows.length} distinct refusal shape(s) across ${modules.length} modules`);
console.log(`  ${"reach".padStart(5)} ${"own".padStart(4)}  shape`);
for (const row of rows.slice(0, 30)) {
  console.log(`  ${String(row.total).padStart(5)} ${String(row.own).padStart(4)}  ${row.shape.slice(0, 88)}`);
}
