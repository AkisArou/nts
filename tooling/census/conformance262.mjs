// Every Test262 case under a directory, each given one of five outcomes, with
// every non-pass attributed to a named cause. A conformance run.
//
//   node tooling/census/conformance262.mjs [--under test/language] [--jobs N]
//        [--sample N] [--rows <jsonl>] [--sites N] [--json <file>]
//        [--record <tsv>] [--check <tsv>] [--recorded <tsv>] [--resume]
//
// `--resume` continues a `--rows` file instead of truncating it. Long node runs
// die on this box -- a full run was killed twice at ~4,800 of 8,005, detached
// or not -- so the rows are the checkpoint. The file's first line names the
// compiler's fingerprint and the directory, and a resume against a different
// binary or directory refuses: rows from two compilers are not one run.
//
// `--recorded <tsv>` is the gate's mode: the population is the cases the record
// names -- the ones that ran -- and each is checked against what it did. Minutes
// rather than the full run's quarter hour, and it answers the question a floor
// asks: did anything that ran stop running, or change its answer? A full run
// re-records, and is what finds new passes.
//
// # Why this exists beside `run262.mjs`
//
// `run262.mjs` builds and runs one file at a time over the slice it can run --
// positive, no `includes:`, strict lane -- and reports buckets over *that
// slice*. Two things it cannot do are what this file is for:
//
//   1. **The suite is the denominator.** A pass rate over files attempted is a
//      different number from a pass rate over files in the suite, and only the
//      second is conformance. Every selected case gets an outcome here,
//      including the ones nobody attempted, and says why it was not attempted.
//   2. **Every non-pass has a cause.** Not the bucket -- the cause, ranked three
//      ways (see "Three rankings").
//
// Both runners call `attempt262.mjs`, so they cannot disagree about what one
// file did; they differ only in which files they ask about and what they say.
//
// # The five outcomes, all reported, every time
//
//   pass         ran, completed. `strict-pass` in `docs/conformance/test262.md`'s
//                words: one strict variant, never promoted to a file pass.
//   fail         ran and was wrong: an uncaught throw. **The serious one.**
//   refused      the compiler declined: a checker error or an `NTS` refusal.
//                Expected, and the useful signal -- it maps onto the refusal
//                families the compiler lane ranks.
//   unsupported  the *harness* cannot run it: a scope exclusion, a negative
//                test (not judged yet), an `includes:` file or a harness entry
//                the stand-in does not provide. A fact about this instrument.
//   no-verdict   crashed, timed out, did not link, or the instrument failed.
//
// **An instrument that scores a file it never ran as a pass** is the failure
// this project has paid for most often -- a census counting transport errors as
// clean, a zero measuring the harness's own blindness, a sweep that ran zero
// iterations and printed `failed=0`. Hence: five outcomes that must sum to the
// population, a reconciliation that fails the run when they do not, and the
// self-checks in `attempt262.mjs` (a control, a sabotage and a refusal arm)
// before anything is counted.
//
// # Exclusions are a column, never a filter
//
// Excluded cases are still run. The headline divides by the population minus
// the exclusions and says how many that is; the raw rate over the whole
// population is printed beside it. Exclusions come from two places, and both
// carry a reason and an authority:
//
//   - `features.json`'s `inapplicable` class -- already the ledger of Test262
//     features that are typescript.md §13 non-goals. Read, not copied: two
//     lists of one fact disagree the day one is edited.
//   - `test262-exclusions.json`, for anything that is not a feature token.
//
// An exclusion naming a feature or path the suite no longer has is an error,
// and an exclusion with a *passing* case is news (FIXED): nothing goes red when
// a decline stops being necessary, so this says it out loud.
//
// # Three rankings
//
// A refused case may carry several causes, and the compiler reports one
// blocker at a time, so "how often is X the cause" has three honest answers:
//
//   first  X is the first root reported             -- where reduction starts
//   sole   X is the only root reported             -- what fixing X would clear
//   any    X is among the roots                     -- reach
//
// `sole` is the work signal; `first` is what earlier censuses ranked. Roots
// exclude the two cascade codes (NTS1003 "because a refusal above", NTS1005
// "this statement is skipped"), which are consequences, not causes. A sole
// cause is sole *among what was reported*: a lowering refusal can stand in
// front of another the compiler has not reached yet.

import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { availableParallelism, homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { selfChecks } from "./attempt262.mjs";
import { HARNESS, HARNESS_THROWS, pinCompiler } from "./project.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "../..");
const SUITE = join(ROOT, "third_party/test262");
const NTS = process.env.NTS_BIN ?? join(ROOT, "target/release/nts");
const CC = process.env.CC ?? "cc";
// Under `~/.cache`, not `/tmp`: `/tmp` is a tmpfs that runs out of inodes
// before bytes, and a full run makes a runtime build per case.
const SCRATCH =
  process.env.NTS_CENSUS_DIR ?? join(homedir(), ".cache/nts/conformance262", String(process.pid));

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};
const under = flag("--under", "test/language");
// Eight, not a fraction of the cores: memory, not CPU, is what ran out. The
// frontend is the large process, and eight of them at their ordinary ~100 MB
// leave room for one case that climbs to the cap.
const jobs = Number(flag("--jobs", String(Math.min(8, availableParallelism()))));
const sample = Number(flag("--sample", "0")) || 0;
const rowsFile = flag("--rows", null);
const resume = argv.includes("--resume");
const jsonFile = flag("--json", null);
const sites = Number(flag("--sites", "25"));
const recordFile = flag("--record", null);
const recordedFile = flag("--recorded", null);
const checkFile = flag("--check", recordedFile);

function cannotMeasure(why) {
  console.log(`  INSTRUMENT FAILURE: ${why}`);
  console.log("  A run cannot report cleanly about programs it could not build.");
  process.exit(2);
}

if (!existsSync(NTS)) cannotMeasure(`no compiler at ${NTS}; set NTS_BIN`);
if (!existsSync(SUITE)) cannotMeasure("no test262 checkout; tooling/bootstrap/bootstrap.sh clones it");

const { path: PINNED, fingerprint: FINGERPRINT } = pinCompiler(NTS, SCRATCH);

// **Every temporary under the scratch, none under `/tmp`.** `cc`, tsgo and the
// test programs all honour `TMPDIR`, and `/tmp` here is a tmpfs shared with
// every lane that runs out of inodes before bytes. Set on this process so the
// workers and everything they spawn inherit it, and removed with the scratch.
process.env.TMPDIR = join(SCRATCH, "tmp");
mkdirSync(process.env.TMPDIR, { recursive: true });
// Per-case address-space cap; `attempt262.mjs`'s `capped` carries why it exists
// and why 6 GB. `NTS_CENSUS_MEMORY_CAP_KB=0` removes it.
const MEMORY_CAP_KB = Number(process.env.NTS_CENSUS_MEMORY_CAP_KB ?? 6_000_000);
// Runtime objects compiled once and kept across runs; `attempt262.mjs`'s
// `withCachedObjects` says why this is the same program and how it is keyed.
const OBJECT_CACHE = process.env.NTS_CENSUS_OBJECT_CACHE ?? join(homedir(), ".cache/nts/c-objects");
const HARNESS_HASH = createHash("sha256").update(HARNESS).update(HARNESS_THROWS).digest("hex").slice(0, 16);
const TOOLS = { nts: PINNED, cc: CC, memoryCapKb: MEMORY_CAP_KB, objectCache: OBJECT_CACHE };

// --- the population --------------------------------------------------------

let records;
try {
  records = execFileSync(
    "cargo",
    [
      "run", "-q", "-p", "nts-suite", "--no-default-features",
      "--bin", "nts-test262-protocol", "--", "select", SUITE, under,
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  )
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
} catch (error) {
  cannotMeasure(`the selection could not be produced: ${String(error.message).split("\n")[0]}`);
}
if (records.length === 0) cannotMeasure(`${under} selected no test`);

// A sample is a *deterministic* subset: ordered by the file's content hash, so
// two runs of one sample size ask about the same files, and the subset is
// spread across directories rather than being the first N of one of them.
/** The paths a record file names, in the order written. */
const recordedPaths = (file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => line.split("\t")[0]);

let population = sample > 0
  ? [...records].sort((a, b) => a.source_hash.localeCompare(b.source_hash)).slice(0, sample)
  : records;
if (recordedFile) {
  const wanted = new Set(recordedPaths(recordedFile));
  population = records.filter((record) => wanted.has(record.path));
}
const partial = sample > 0 || recordedFile !== null;

// --- exclusions ------------------------------------------------------------

const FEATURES = JSON.parse(readFileSync(join(HERE, "features.json"), "utf8"));
const EXTRA = JSON.parse(readFileSync(join(HERE, "test262-exclusions.json"), "utf8"));

/** `{ id, kind, match, reason, authority }` -- one list, from two ledgers. */
const exclusions = [
  ...Object.entries(FEATURES.features ?? FEATURES)
    .filter(([name, entry]) => !name.startsWith("//") && entry?.class === "inapplicable")
    .map(([name, entry]) => ({
      id: `feature:${name}`,
      kind: "feature",
      match: name,
      reason: entry.reason,
      authority: entry.authority,
      source: "features.json",
    })),
  ...EXTRA.exclusions.map((entry) => ({
    id: `${entry.kind}:${entry.match}`,
    ...entry,
    source: "test262-exclusions.json",
  })),
];

const excludedBy = (record) =>
  exclusions.filter((entry) =>
    entry.kind === "feature"
      ? record.features.includes(entry.match)
      : entry.kind === "path"
        ? record.path === entry.match || record.path.startsWith(entry.match.endsWith("/") ? entry.match : `${entry.match}/`)
        : false,
  );

// The audit runs against the *whole* selection, not the sample: a sample that
// happens to miss a feature must not make its exclusion look stale.
const audit = { withoutReason: [], naming_nothing: [], unknownKind: [] };
for (const entry of exclusions) {
  if (!entry.reason || !entry.authority) audit.withoutReason.push(entry.id);
  if (entry.kind !== "feature" && entry.kind !== "path") audit.unknownKind.push(entry.id);
  else if (!records.some((record) => excludedBy(record).includes(entry))) {
    // Only an error for exclusions that could name something under `under`:
    // a `built-ins` path is not stale because this run is `test/language`.
    const inScope = entry.kind === "feature" || entry.match.startsWith(under);
    if (inScope && entry.kind === "path") audit.naming_nothing.push(entry.id);
    if (entry.kind === "feature" && inScope) entry.unseen = true;
  }
}

// --- the harness boundary ----------------------------------------------------
//
// A case the stand-in cannot express is `unsupported` *before* it is compiled,
// with the reason, so that a missing harness entry is never ranked as a
// compiler refusal. Without this, 7,074 of the 15,078 positive no-include cases
// under `test/language` -- 3,601 calling `assert.throws`, 3,835 async `$DONE`
// tests -- arrived as TypeScript errors ("Property 'X' does not exist on type
// 'X'") and would have topped the refusal ranking as the compiler's fault.

const FRONTMATTER = /\/\*---([\s\S]*?)---\*\//;

function harnessGap(record, source) {
  if (record.schedule !== "planned") return `scope:${record.reason ?? record.schedule}`;
  if (record.negative) return `negative:${record.negative.phase} (negative verdicts are not judged yet)`;
  if (record.includes.length > 0) return `include:${[...record.includes].sort().join("+")}`;
  const meta = FRONTMATTER.exec(source)?.[1] ?? "";
  const flags = /^\s*flags:\s*\[([^\]]*)\]/m.exec(meta)?.[1] ?? "";
  if (/\basync\b/.test(flags)) return "harness:async ($DONE)";
  const body = source.replace(FRONTMATTER, "");
  if (/\$262\b/.test(body)) return "harness:$262";
  return null;
}

/**
 * A checker error that names the stand-in rather than the test.
 *
 * `class assert` is not callable, so a test calling `assert(cond)` -- the
 * harness's base entry -- reports `typeof assert` is not callable; a member the
 * stand-in lacks reports it does not exist on `typeof assert`. Both are ours.
 */
const CASCADE = new Set(["NTS1003", "NTS1005"]);
const HARNESS_NAMES = new Set(["typeof assert", "Test262Error", "$DONE", "$262", "print"]);
// Roots only: a cascade (NTS1005 "this statement is skipped") has been seen
// located at the end of the harness when the skipped statement is the test's
// first -- its span starts at the leading trivia -- so its place says nothing.
//
// **Named, not placed.** A root *located* in the stand-in is still the
// compiler's: `assert.throws` must call a function value inside a `try`, and the
// refusal of that is a compiler gap any implementation of the harness would hit.
// It is ranked as refused, with `[in the harness]` on its cause key. Only a
// diagnostic that *names* a stand-in gap -- `assert` not callable, `$DONE`
// missing -- is ours alone, and `unsupported`.
const namesHarness = (diagnostic) =>
  !CASCADE.has(diagnostic.code) && diagnostic.named.some((name) => HARNESS_NAMES.has(name));

// --- attempts, in parallel workers -----------------------------------------

async function runAll(all) {
  const results = new Map();
  let paths = all;
  if (paths.length === 0) return results;
  // The harness is part of what a row measured: a stand-in that gains an
  // overload changes which cases typecheck, so rows from two harnesses are two
  // runs even under one compiler.
  const header = { fingerprint: FINGERPRINT, under, harness: HARNESS_HASH };
  if (rowsFile && resume && existsSync(rowsFile)) {
    const [first, ...rest] = readFileSync(rowsFile, "utf8").split("\n");
    let was = null;
    try { was = JSON.parse(first); } catch {}
    if (was?.fingerprint !== FINGERPRINT || was?.under !== under || was?.harness !== HARNESS_HASH) {
      cannotMeasure(`${rowsFile} was written by ${was?.fingerprint ?? "no named compiler"} over ${was?.under} ` +
        `with harness ${was?.harness ?? "unnamed"}; this run is ${FINGERPRINT} over ${under} with harness ${HARNESS_HASH}`);
    }
    const wanted = new Set(paths);
    for (const line of rest) {
      if (line === "") continue;
      let row;
      // A run killed mid-write leaves a partial last line; it is re-attempted.
      try { row = JSON.parse(line); } catch { continue; }
      if (wanted.has(row.path)) results.set(row.path, row);
    }
    writeFileSync(rowsFile, [JSON.stringify(header), ...[...results.values()].map((row) => JSON.stringify(row))].join("\n") + "\n");
    process.stderr.write(`  resumed: ${results.size} row(s) kept from ${rowsFile}\n`);
    paths = paths.filter((path) => !results.has(path));
  } else if (rowsFile) writeFileSync(rowsFile, `${JSON.stringify(header)}\n`);
  let next = 0;
  let done = 0;
  const started = Date.now();
  const worker = (index) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [join(HERE, "attempt262-worker.mjs"), join(SCRATCH, `w${index}`), PINNED, CC, SUITE, String(MEMORY_CAP_KB), OBJECT_CACHE],
        { stdio: ["pipe", "pipe", "inherit"] },
      );
      const feed = () => {
        if (next < paths.length) child.stdin.write(`${paths[next++]}\n`);
        else child.stdin.end();
      };
      createInterface({ input: child.stdout }).on("line", (line) => {
        const row = JSON.parse(line);
        results.set(row.path, row);
        if (rowsFile) appendFileSync(rowsFile, `${line}\n`);
        done += 1;
        if (done % 500 === 0) {
          const rate = done / ((Date.now() - started) / 1000);
          process.stderr.write(`  ${done}/${paths.length} attempted (${rate.toFixed(1)}/s)\n`);
        }
        feed();
      });
      child.on("error", reject);
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker ${index} exited ${code}`))));
      feed();
    });
  if (paths.length > 0) {
    await Promise.all(Array.from({ length: Math.min(jobs, paths.length) }, (_, index) => worker(index)));
  }
  return results;
}

// --- classification ---------------------------------------------------------

const causeKey = (d) => `${d.code} ${d.message}${d.where === "harness" ? " [in the harness]" : ""}`;

function classify(row) {
  switch (row.bucket) {
    case "strict-pass":
      return { outcome: "pass" };
    case "threw":
      return {
        outcome: "fail",
        cause: `threw ${row.thrown}`,
        detail: row.message ?? `uncaught ${row.thrown}`,
      };
    case "unsupported": {
      if (row.why === "link") {
        // C the compiler wrote and `cc` would not take: no verdict, and a
        // compiler defect rather than a decline -- nothing refused it.
        return { outcome: "no-verdict", cause: `link: ${row.first ?? "?"}` };
      }
      if (row.why === "emit") return { outcome: "no-verdict", cause: "emit-c exited non-zero with no diagnostic" };
      const diagnostics = row.diagnostics ?? [];
      if (diagnostics.some(namesHarness)) {
        const which = diagnostics.find(namesHarness);
        return { outcome: "unsupported", cause: `harness:${which.code} ${which.message}` };
      }
      const roots = diagnostics.filter((d) => !CASCADE.has(d.code));
      if (roots.length === 0) {
        return { outcome: "refused", cause: "(cascade only: no root reported)", roots: [] };
      }
      return { outcome: "refused", cause: causeKey(roots[0]), roots };
    }
    case "timeout":
      return { outcome: "no-verdict", cause: `timeout${row.why ? ` (${row.why})` : ""}` };
    case "crash":
      return { outcome: "no-verdict", cause: `crash (${row.why})${row.first ? `: ${row.first}` : ""}` };
    case "memory-cap":
      return { outcome: "no-verdict", cause: `exceeded the ${MEMORY_CAP_KB / 1e6} GB address-space cap (${row.why})` };
    case "invalid-hir":
      return { outcome: "no-verdict", cause: `invalid HIR: ${row.first}` };
    case "frontend-crash":
      return { outcome: "no-verdict", cause: "frontend crash" };
    default:
      return { outcome: "no-verdict", cause: `${row.bucket}${row.why ? `: ${row.why}` : ""}` };
  }
}

// --- the run -----------------------------------------------------------------

const checks = selfChecks(SCRATCH, TOOLS, cannotMeasure);

const cases = population.map((record) => {
  const source = readFileSync(join(SUITE, record.path), "utf8");
  return { record, gap: harnessGap(record, source), excluded: excludedBy(record) };
});
const toAttempt = cases.filter((c) => c.gap === null).map((c) => c.record.path);
const rows = await runAll(toAttempt);

for (const c of cases) {
  if (c.gap !== null) {
    Object.assign(c, { outcome: "unsupported", cause: c.gap });
    continue;
  }
  const row = rows.get(c.record.path);
  if (!row) {
    Object.assign(c, { outcome: "no-verdict", cause: "no row came back for this case" });
    continue;
  }
  Object.assign(c, classify(row));
  if (row.diagnostics) c.named = [...new Set(row.diagnostics.flatMap((d) => d.named))];
}

rmSync(SCRATCH, { recursive: true, force: true });

// --- tallies -------------------------------------------------------------------

const OUTCOMES = ["pass", "fail", "refused", "unsupported", "no-verdict"];
const objectTally = { hit: 0, miss: 0 };
for (const row of rows.values()) {
  objectTally.hit += row.objects?.hit ?? 0;
  objectTally.miss += row.objects?.miss ?? 0;
}
const count = (list, pick) => {
  const map = new Map();
  for (const item of list) for (const key of [pick(item)].flat()) map.set(key, (map.get(key) ?? 0) + 1);
  return [...map].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
};
const tally = Object.fromEntries(OUTCOMES.map((o) => [o, cases.filter((c) => c.outcome === o).length]));
const summed = OUTCOMES.reduce((sum, o) => sum + tally[o], 0);
const excludedCases = cases.filter((c) => c.excluded.length > 0);
const inScope = cases.filter((c) => c.excluded.length === 0);
const inScopePass = inScope.filter((c) => c.outcome === "pass").length;

const refused = cases.filter((c) => c.outcome === "refused");
const rankFirst = count(refused, (c) => c.cause);
const rankAny = count(refused, (c) => [...new Set(c.roots.map(causeKey))]);
const rankSole = count(
  refused.filter((c) => new Set(c.roots.map(causeKey)).size === 1),
  (c) => c.cause,
);
const family = (c) => {
  const code = c.roots[0]?.code ?? "";
  return code.startsWith("TS") ? "checker (TS)" : code.startsWith("NTS1") ? "lowering (NTS1xxx)" : code.startsWith("NTS2") ? "backend/verifier (NTS2xxx)" : "other";
};
const rankNamed = count(
  refused.filter((c) => c.roots.some((d) => d.code.startsWith("NTS"))),
  (c) => [...new Set(c.roots.filter((d) => d.code.startsWith("NTS")).flatMap((d) => d.named))],
);

const exclusionReport = exclusions.map((entry) => {
  const matched = cases.filter((c) => c.excluded.includes(entry));
  return {
    id: entry.id,
    reason: entry.reason,
    source: entry.source,
    cases: matched.length,
    passing: matched.filter((c) => c.outcome === "pass").length,
    unseen: entry.unseen === true,
  };
});

// --- recorded outcomes --------------------------------------------------------
//
// The cases that *ran* -- pass and fail -- are recorded one per line with what
// they did. A fail's record is its uncaught line, so the record fails when the
// answer changes in **either** direction: fixed, or wrong differently. Refused
// and unsupported cases are not recorded; they churn with every compiler
// change and the ranking above is where they are read. A case that leaves the
// ran-set is reported (it regressed into a refusal or worse); a case that
// enters it is news.

const recordedRow = (c) => `${c.record.path}\t${c.outcome}\t${c.outcome === "fail" ? c.detail : ""}`;
const ranRows = cases.filter((c) => c.outcome === "pass" || c.outcome === "fail");
if (recordFile) {
  writeFileSync(
    recordFile,
    `# Test262 ${under} cases that ran, and what each did. Written by\n` +
      `# tooling/census/conformance262.mjs --record; compared by --check.\n` +
      ranRows.map(recordedRow).sort().join("\n") + "\n",
  );
}
let comparison = null;
if (checkFile) {
  const before = new Map(
    readFileSync(checkFile, "utf8")
      .split("\n")
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => {
        const [path, outcome, detail] = line.split("\t");
        return [path, { outcome, detail }];
      }),
  );
  const now = new Map(cases.map((c) => [c.record.path, c]));
  comparison = { REGRESSED: [], "NEW FAIL": [], CHANGED: [], FIXED: [], "NEW PASS": [], MISSING: [] };
  for (const [path, was] of before) {
    const c = now.get(path);
    if (!c) {
      // A sample does not see the whole record; only a full run may call a
      // recorded case missing.
      if (!partial || recordedFile) comparison.MISSING.push(`${path}: recorded, not in the selection`);
      continue;
    }
    if (was.outcome === "pass" && c.outcome !== "pass") comparison.REGRESSED.push(`${path}: pass -> ${c.outcome} (${c.cause ?? ""})`);
    if (was.outcome === "fail" && c.outcome === "pass") comparison.FIXED.push(`${path}: fail -> pass`);
    if (was.outcome === "fail" && c.outcome === "fail" && c.detail !== was.detail) comparison.CHANGED.push(`${path}: ${was.detail} -> ${c.detail}`);
    if (was.outcome === "fail" && c.outcome !== "fail" && c.outcome !== "pass") comparison.REGRESSED.push(`${path}: fail -> ${c.outcome} (${c.cause ?? ""})`);
  }
  for (const c of ranRows) {
    if (before.has(c.record.path)) continue;
    if (c.outcome === "pass") comparison["NEW PASS"].push(c.record.path);
    else comparison["NEW FAIL"].push(`${c.record.path}: ${c.detail}`);
  }
}

// --- the report ----------------------------------------------------------------

const pct = (n, d) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(2)}%`);
const pin = execFileSync("git", ["-C", SUITE, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const out = [];
const say = (line = "") => out.push(line);

say(`  pin ${pin}`);
say(`  compiler ${NTS} (sha256:${FINGERPRINT}), harness sha256:${HARNESS_HASH}`);
say(`  runtime objects: ${objectTally.hit} cached, ${objectTally.miss} compiled (${OBJECT_CACHE})`);
say(`  self-checks: control ${checks.control}, sabotage ${checks.sabotage}, refused ${checks.refused}`);
say(
  `  ${under}: ${records.length} case(s) in the selection` +
    (sample > 0 ? `, a deterministic sample of ${population.length}` : "") +
    `; ${toAttempt.length} attempted, ${rows.size} came back, ${jobs} worker(s)`,
);
say();
say(`  outcome        cases   of ${population.length}`);
for (const o of OUTCOMES) say(`  ${o.padEnd(12)} ${String(tally[o]).padStart(7)}   ${pct(tally[o], population.length).padStart(7)}`);
say(`  ${"sum".padEnd(12)} ${String(summed).padStart(7)}`);
say();
if (partial) {
  // A headline over a sample or over the recorded set is not conformance: the
  // denominator is not the suite. Printed as what it is, and nothing else.
  say(`  ${recordedFile ? "recorded cases" : "sample"}: ${tally.pass} of ${population.length} pass -- ` +
    "not a conformance rate; the denominator is not the suite");
  say(`  pass-count: ${tally.pass}`);
} else say(
  `  headline: ${inScopePass} of ${inScope.length} in-scope cases pass (${pct(inScopePass, inScope.length)}), ` +
    `excluding ${excludedCases.length} case(s) under ${exclusions.length} exclusion(s); ` +
    `${tally.pass} of ${population.length} (${pct(tally.pass, population.length)}) with nothing excluded`,
);
say("  `pass` is strict-pass: one strict variant per file, never promoted to a file pass");
say();
say(`  not attempted, by harness cause (${tally.unsupported} case(s)):`);
for (const [cause, n] of count(cases.filter((c) => c.outcome === "unsupported"), (c) => c.cause.startsWith("include:") && c.cause.includes("+") ? "include:(several)" : c.cause).slice(0, sites)) {
  say(`    ${String(n).padStart(6)}  ${cause}`);
}
say();
say(`  fail -- ran and was wrong (${tally.fail} case(s)), by what was thrown:`);
for (const [cause, n] of count(cases.filter((c) => c.outcome === "fail"), (c) => c.cause)) say(`    ${String(n).padStart(6)}  ${cause}`);
say();
say(`  no verdict (${tally["no-verdict"]} case(s)):`);
for (const [cause, n] of count(cases.filter((c) => c.outcome === "no-verdict"), (c) => c.cause).slice(0, sites)) say(`    ${String(n).padStart(6)}  ${cause}`);
say();
say(`  refused (${refused.length} case(s), ${rankAny.length} distinct root cause(s)), by family of the first root:`);
for (const [f, n] of count(refused, family)) say(`    ${String(n).padStart(6)}  ${f}`);
const table = (title, ranking) => {
  say();
  say(`  ${title}`);
  for (const [cause, n] of ranking.slice(0, sites)) say(`    ${String(n).padStart(6)}  ${cause}`);
  if (ranking.length > sites) say(`    ... ${ranking.length - sites} more`);
};
table("refused, ranked by SOLE root -- what fixing that cause alone would clear:", rankSole);
table("refused, ranked by FIRST root -- where reduction starts:", rankFirst);
table("refused, ranked by ANY root -- reach:", rankAny);
table("names quoted by NTS roots (builtins, members), by cases:", rankNamed);
say();
say(`  exclusions: ${exclusions.length} entr(ies), ${audit.withoutReason.length} without a reason or authority, ` +
  `${audit.naming_nothing.length} naming a path the suite does not have, ${audit.unknownKind.length} of an unknown kind`);
for (const e of exclusionReport) {
  say(`    ${String(e.cases).padStart(6)}  ${e.id} -- ${e.reason} (${e.source})` +
    (e.passing > 0 ? `   FIXED? ${e.passing} passing` : "") + (e.unseen ? "   (no case under this directory declares it)" : ""));
}
for (const id of [...audit.withoutReason, ...audit.naming_nothing, ...audit.unknownKind]) say(`    AUDIT FAILURE: ${id}`);
if (comparison) {
  say();
  say(`  against ${checkFile}:`);
  for (const [kind, list] of Object.entries(comparison)) {
    say(`    ${String(list.length).padStart(6)}  ${kind}`);
    for (const line of list.slice(0, 20)) say(`              ${line}`);
    if (list.length > 20) say(`              ... ${list.length - 20} more`);
  }
}

// The run fails -- exit 1 -- on anything that means it did not measure.
const problems = [];
if (summed !== population.length) problems.push(`outcomes sum to ${summed}, not the ${population.length} cases selected`);
if (rows.size !== toAttempt.length) problems.push(`${toAttempt.length - rows.size} attempted case(s) came back with no row`);
if (audit.withoutReason.length + audit.naming_nothing.length + audit.unknownKind.length > 0) problems.push("the exclusion audit failed");
if (comparison && (comparison.REGRESSED.length + comparison.MISSING.length + comparison.CHANGED.length + comparison["NEW FAIL"].length > 0)) {
  problems.push("the recorded outcomes changed; see above, then re-record with --record if intended");
}
say();
say(problems.length === 0 ? "  reconciled" : problems.map((p) => `  NOT RECONCILED: ${p}`).join("\n"));
console.log(out.join("\n"));

if (jsonFile) {
  writeFileSync(jsonFile, JSON.stringify({
    pin, compiler: NTS, fingerprint: FINGERPRINT, under, selected: records.length, population: population.length,
    attempted: toAttempt.length, checks, tally, inScope: inScope.length, inScopePass, excluded: excludedCases.length,
    rankSole, rankFirst, rankAny, rankNamed, exclusions: exclusionReport, comparison, problems,
  }, null, 2));
}
process.exit(problems.length === 0 ? 0 : 1);
