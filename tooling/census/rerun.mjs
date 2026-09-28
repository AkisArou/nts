// Did a change *gain* test262 cases? Re-run only the cases whose recorded
// reason it could have moved, under the binary before and the binary after.
//
//   node tooling/census/rerun.mjs --rows <rows> [<rows> ...] <filters> --before <nts> --after <nts>
//        [--jobs N] [--list N]
//
// filters: rows.mjs's own -- --message, --code, --where, --first, --bucket,
// --why, --path, --source -- each a regular expression, all of which must hold.
//
// # Why
//
// `conformance262 --recorded` re-runs the cases that ran, so it answers "did
// anything break", and cannot see a case outside the record that newly
// passes. Only a full run (~29k files) answers "did anything improve", which
// is too expensive to be an arm on an ordinary change -- so every lowering
// change was measured for regression and never for the gain it was landed
// for. A change removes a particular refusal; the cases it can gain are the
// ones whose recorded reason names it. So: select those from a full census's
// rows, and re-run just them.
//
// # Two arms, not one against the record
//
// The rows are only the *selection*. The selected cases run under both
// binaries, and the verdicts come from those two runs, so a case that moved
// because the tree moved since the census is not read as this change's. The
// selection is small, so running it twice is cheap.
//
// Per file:
//   FIXED   not a pass before, a pass after
//   WORSE   a pass before, not after
//   MOVED   neither passes, and the bucket or the cause changed: the change
//           reached it and the next blocker is now what stops it
//   same    what it was
//
// Exit 0 with no WORSE; 1 with any; 2 when it could not run.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { armLines } from "../conformance/pin.mjs";
import { filterFrom, readRows } from "./rows.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const PASS = "strict-pass";

/** `--name value` pairs, and every value of `--rows`. */
function parse(argv) {
  const opts = {};
  const rows = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--rows") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) rows.push(argv[++i]);
    } else if (argv[i].startsWith("--")) opts[argv[i].slice(2)] = argv[++i];
  }
  return { opts, rows };
}

/** One file's verdict between two arms' rows. */
export function verdict(before, after) {
  const pass = (r) => r?.bucket === PASS;
  const cause = (r) => `${r?.bucket}|${r?.why ?? ""}|${r?.first ?? ""}|${(r?.diagnostics ?? []).find((d) => d.code === "NTS1001")?.message ?? ""}`;
  if (!before || !after) return "not measured";
  if (!pass(before) && pass(after)) return "FIXED";
  if (pass(before) && !pass(after)) return "WORSE";
  if (cause(before) !== cause(after)) return "MOVED";
  return "same";
}

// **Seen to classify before it is trusted.**
function selfTest() {
  const r = (bucket, message) => ({ bucket, why: bucket === PASS ? undefined : "lowering", diagnostics: message ? [{ code: "NTS1001", message }] : [] });
  const cases = [
    [r("unsupported", "a"), r(PASS), "FIXED"],
    [r(PASS), r("threw"), "WORSE"],
    [r("unsupported", "a"), r("unsupported", "b"), "MOVED"],
    [r("unsupported", "a"), r("unsupported", "a"), "same"],
    [r("unsupported", "a"), undefined, "not measured"],
  ];
  for (const [a, b, want] of cases) if (verdict(a, b) !== want) return `${JSON.stringify([a, b])} read as ${verdict(a, b)}, not ${want}`;
  return null;
}

const argv = process.argv.slice(2);
const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (argv.includes("--self-test")) {
  console.log("  self-test: fixed, worse, moved, same and not measured each classified");
  process.exit(0);
}

const { opts, rows: rowFiles } = parse(argv);
if (rowFiles.length === 0 || !opts.before || !opts.after) {
  console.log("  usage: rerun.mjs --rows <rows> ... <filters> --before <nts> --after <nts> [--jobs N] [--list N]");
  process.exit(2);
}
for (const bin of [opts.before, opts.after]) {
  if (!existsSync(bin)) {
    console.log(`  NOT MEASURED: no compiler at ${bin}`);
    process.exit(2);
  }
}

// --- the selection -------------------------------------------------------------

const keep = filterFrom(opts);
const selected = rowFiles.flatMap((f) => [...readRows(readFileSync(f, "utf8")).values()]).filter(keep);
const byDir = new Map();
for (const r of selected) {
  const dir = r.path.split("/").slice(0, 2).join("/");
  byDir.set(dir, [...(byDir.get(dir) ?? []), r.path]);
}
console.log(`  ${selected.length} recorded case(s) match, in ${[...byDir].map(([d, p]) => `${d} ${p.length}`).join(", ") || "nothing"}`);
for (const line of armLines(opts.before, opts.after)) console.log(`  ${line}`);
if (selected.length === 0) process.exit(0);

// --- two arms ------------------------------------------------------------------

const base = join(homedir(), ".cache/nts-rerun");
mkdirSync(base, { recursive: true });
const scratch = mkdtempSync(join(base, "run-"));
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));

/** One arm over one directory's selection: its rows, keyed by path. */
function arm(name, bin, dir, paths) {
  const tsv = join(scratch, `${dir.replace(/\//g, "_")}.tsv`);
  writeFileSync(tsv, `${paths.join("\n")}\n`);
  const out = join(scratch, `${name}-${dir.replace(/\//g, "_")}.rows`);
  const run = spawnSync("node", [
    join(HERE, "conformance262.mjs"), "--under", dir, "--recorded", tsv, "--rows", out,
    ...(opts.jobs ? ["--jobs", opts.jobs] : []),
  ], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1 << 26,
    env: { ...process.env, NTS_BIN: bin, NTS_CENSUS_DIR: join(scratch, `census-${name}-${dir.replace(/\//g, "_")}`) },
  });
  if (!existsSync(out)) {
    console.log(`  NOT MEASURED: the ${name} arm over ${dir} wrote no rows -- ${`${run.stdout}${run.stderr}`.trim().split("\n").slice(-2).join(" / ")}`);
    process.exit(2);
  }
  return readRows(readFileSync(out, "utf8"));
}

const tally = new Map();
const lists = new Map();
for (const [dir, paths] of byDir) {
  const before = arm("before", opts.before, dir, paths);
  const after = arm("after", opts.after, dir, paths);
  for (const path of paths) {
    const v = verdict(before.get(path), after.get(path));
    tally.set(v, (tally.get(v) ?? 0) + 1);
    const b = before.get(path);
    const a = after.get(path);
    const reason = (r) => (r ? `${r.bucket}${r.why ? `/${r.why}` : ""}${r.first ? `: ${r.first}` : ""}${(r.diagnostics ?? []).find((d) => d.code === "NTS1001") ? `: ${r.diagnostics.find((d) => d.code === "NTS1001").message}` : ""}` : "(none)");
    if (v !== "same") lists.set(v, [...(lists.get(v) ?? []), `${path}\n        ${reason(b).slice(0, 110)}\n     -> ${reason(a).slice(0, 110)}`]);
  }
}

console.log(`\n  ${[...tally].map(([v, n]) => `${n} ${v}`).join(", ")}`);
for (const v of ["WORSE", "FIXED", "MOVED", "not measured"]) {
  const items = lists.get(v) ?? [];
  if (items.length === 0) continue;
  console.log(`\n  ${v}: ${items.length}`);
  for (const item of items.slice(0, Number(opts.list ?? 15))) console.log(`    ${item}`);
  if (items.length > Number(opts.list ?? 15)) console.log(`    ... ${items.length - Number(opts.list ?? 15)} more`);
}
process.exit((tally.get("WORSE") ?? 0) > 0 ? 1 : 0);
