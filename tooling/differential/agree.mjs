// Does this change alter any answer? The examples differential, without the gate.
//
//   node tooling/differential/agree.mjs <nts>                 every example against node
//   node tooling/differential/agree.mjs <before> <after>      which answers <after> changed
//   node tooling/differential/agree.mjs <nts> --only=a,b      named examples only
//   node tooling/differential/agree.mjs --self-test
//
//   NTS_BACKEND, NTS_RC and NTS_POISON pass through to `nts check`, as in the gate.
//   NTS_AGREE_JOBS overrides the worker count.
//
// # Why
//
// Every other quick instrument counts *refusals*: the definitions floor,
// phantoms, the censuses of `runtime/node` and `runtime/web-platform`. A
// program that compiles and returns the wrong number moves none of them. On
// 2026-09-26 four such measurements called one commit clean, and the commit was
// reverted for a wrong answer that only the examples differential saw -- and
// the only thing running that was `tooling/gate/all.sh`, fifty minutes and a
// pinned tree away. Its stand-in was an `xargs` loop grepping for
// "disagree between", four times in one night. This is that loop, made into
// something you run *before* a commit.
//
// # What one example's run is
//
// Not a boolean. `nts check` says what happened, in the lines
// `tooling/cli/src/main.rs` `check` prints, and the record keeps all of it:
// the outcome, how many cases were compared out of how many the pool asked
// for, how many the compiled program declined, how many timed out, how many
// functions lowering refused, and the disagreeing and aborting lines
// themselves. Two binaries are compared on the whole record, so a change that
// adds four declines to an example that still prints `agreed on every case`
// is reported rather than passed. An abort hides exactly there: a decline is
// how the harness reads a program that stopped.
//
// # What it could not compare is a number, never a silence
//
// `nothing to check` and a partial comparison both exit 0 from `nts check`,
// and both used to read as agreement. The summary counts them apart, with the
// declined, timed-out and unreached cases summed across the corpus. An example
// the tool could not run at all is NOT MEASURED, printed with the first line
// of what the compiler said, and fails the run: a frontend that never started
// makes every example fail identically and must not read as a regression, nor
// as a pass.
//
// # The binary is pinned by content
//
// `target/release/nts` is whichever session built last, and it can be
// replaced halfway through a run. Each binary is copied by its sha256 into
// `~/.cache/nts-agree/bin/` before anything runs, and every case runs from the
// copy; the report names the hash, the source path and its mtime. Two
// arguments with the same hash are refused: that comparison can only say
// "nothing changed", whatever the change was.
//
// Each pinned binary keeps its own snapshot cache beside it. The frontend's
// cache holds one entry per project, stamped with the compiler that wrote it,
// so two binaries sharing one cache evict each other on every example: the
// first two-binary run took 532 s where one binary took 115. A binary's
// directory is pruned after a day unused, beyond the newest six.
//
// # A difference is confirmed before it is attributed
//
// An example whose two records differ runs again under both binaries. If
// either binary disagrees with its own first run, the example is UNSTABLE --
// a timeout under load, a race in the program -- and is listed, not
// attributed. Otherwise the change is the binary's:
//
//   FIXED      after agrees and before did not, or it compares strictly more
//   REGRESSED  before agreed and after does not, or it compares strictly less
//   CHANGED    anything else: a different disagreement, a different refusal count
//
// FIXED prints and passes. REGRESSED, CHANGED, UNSTABLE and NOT MEASURED fail.
// An example that is wrong the same way under both is listed as *wrong under
// both* and does not fail an attribution run -- that is not this change's
// answer -- but it is never hidden.
//
// Exit 0: nothing wrong (one binary) or nothing made worse (two). Exit 1: a
// wrong answer, or a change. Exit 2: something could not be measured, or the
// tool could not start.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync,
  utimesSync, writeFileSync,
} from "node:fs";
import { availableParallelism, freemem, homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { armLines, oneChange } from "../conformance/pin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const CACHE = join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "nts-agree");
// One example's whole differential: lowering, a C build, two runs. The largest
// take seconds; this bounds a hang, not a slow case.
const TIMEOUT_MS = 300_000;

/** The outcomes, in the words `nts check` uses for them. */
export const Outcome = Object.freeze({
  AGREES: "agrees",
  PARTIAL: "agrees on what it compared",
  NOTHING: "nothing to check",
  DISAGREES: "disagrees",
  ABORTED: "aborted",
  ALL_DECLINED: "declined every case",
  BACKEND_DECLINED: "backend declined",
  INVALID_HIR: "invalid HIR",
  NO_TYPECHECK: "does not typecheck",
  NOT_MEASURED: "not measured",
});
/** Outcomes that are a wrong or missing answer about the program. */
const WRONG = new Set([
  Outcome.DISAGREES, Outcome.ABORTED, Outcome.ALL_DECLINED, Outcome.BACKEND_DECLINED, Outcome.INVALID_HIR,
  Outcome.NO_TYPECHECK,
]);
/** A refusal *caused by* another -- "because it calls", "this statement is skipped". */
const CASCADE = /^ {2}refused: NTS100[35] /;
/** Outcomes that compared something and found no difference. */
const AGREEING = new Set([Outcome.AGREES, Outcome.PARTIAL]);

// Examples that exist *not* to be compared, each with its reason -- the same
// two the gate's `backend_examples` passes over.
const NOT_DIFFERENTIAL = new Map([
  ["invalid", "does not typecheck on purpose"],
  ["unsupported", "exists to document refusals"],
]);

/**
 * One `nts check` run, as a record. `status` is the exit code (null if it was
 * killed), `out` its stdout and stderr together.
 *
 * Keyed on the lines `check` in `tooling/cli/src/main.rs` prints and the
 * errors `nts_differential::check` raises. A message this does not recognise
 * is NOT MEASURED with its first line, never a pass and never a disagreement.
 */
export function classify(status, out) {
  const count = (re) => Number(re.exec(out)?.[1] ?? 0);
  const reached = /^checked (\d+) of (\d+) cases/m.exec(out);
  const full = /^checked (\d+) cases across/m.exec(out);
  const record = {
    checked: Number(reached?.[1] ?? full?.[1] ?? 0),
    expected: Number(reached?.[2] ?? full?.[1] ?? 0),
    declined: count(/^(\d+) case\(s\) the compiled program declined/m),
    timeouts: count(/^(\d+) case\(s\) ran out of time/m),
    // Lowering's refusals: each one can take a function out of what is driven.
    // `check` prints the cascades too, and `tooling/gate/example-refusals`
    // counts roots only -- the same example reads 3 here and 1 there, by
    // design, so both are kept and both are printed.
    refused: out.split("\n").filter((line) => line.startsWith("  refused: ")).length,
    refusedRoots: out.split("\n").filter((line) => line.startsWith("  refused: ") && !CASCADE.test(line)).length,
    // What the two sides answered where they differ, verbatim: two runs that
    // disagree *differently* are two different answers. Not the harness's
    // own `node stopped part-way:`, which shares the `  node ` prefix.
    answers: out.split("\n").filter((line) =>
      /^ {2}(?:nts {2}|node |the compiled program aborted: )/.test(line) && !line.startsWith("  node stopped part-way: ")),
    // The oracle died before its `done` line -- a hostile pool value can run
    // node out of heap. The cases after it are unreached on both sides, which
    // `checked` already says; the message carries node's GC log, so it is
    // counted, never compared.
    oracleStopped: out.split("\n").filter((line) => line.startsWith("  node stopped part-way: ")).length,
  };
  const first = out.split("\n").find((line) => line.trim() !== "")?.trim().slice(0, 120) ?? "(no output)";
  const outcome = (() => {
    if (status === 0) {
      if (/^nothing to check/m.test(out)) return Outcome.NOTHING;
      if (!/^agreed on every case$/m.test(out)) return Outcome.NOT_MEASURED;
      const whole = record.checked === record.expected && record.declined === 0 && record.timeouts === 0;
      return whole ? Outcome.AGREES : Outcome.PARTIAL;
    }
    if (status === null) return Outcome.NOT_MEASURED;
    if (/disagree between the compiled program and node/.test(out)) return Outcome.DISAGREES;
    if (/the compiled program aborted \d+ time/.test(out)) return Outcome.ABORTED;
    if (/no case was checked: all \d+ declined/.test(out)) return Outcome.ALL_DECLINED;
    if (/the (?:LLVM )?backend declined \d+ function/.test(out)) return Outcome.BACKEND_DECLINED;
    if (/invalid HIR/.test(out)) return Outcome.INVALID_HIR;
    // A workspace dependency that will not resolve is not a typecheck
    // regression: `examples/library` in a worktree. Same keys as the gate.
    if (/TS2307|TS6059/.test(out)) {
      record.unresolved = true;
      return Outcome.NOT_MEASURED;
    }
    if (/does not typecheck|refusing to proceed/.test(out)) return Outcome.NO_TYPECHECK;
    return Outcome.NOT_MEASURED;
  })();
  const said = record.unresolved ? "needs an installed workspace; cannot resolve here" : first;
  delete record.unresolved;
  return { outcome, ...record, first: said };
}

/**
 * The line `tooling/gate/all.sh`'s `backend_examples` reads for one example:
 * `ok`, `partial <tab> why`, `bare`, `no` or `unmeasured <tab> why`, each
 * followed by the name.
 *
 * A projection of the record, and deliberately no more permissive than the
 * shell classifier it replaced. `no` counts against a floor that may have
 * slack, while `unmeasured` fails the step outright, so every outcome that
 * classifier failed outright stays `unmeasured` here. That means every case
 * declined, and any text it did not recognise.
 * `partial` keeps its gate meaning -- the program *declined* cases -- so the
 * step's ceiling counts what it always counted; a comparison short only of
 * timeouts or unreached cases is `ok` there, as it was.
 */
export function verdict(name, r) {
  switch (r.outcome) {
    case Outcome.AGREES:
      return `ok ${name}`;
    case Outcome.PARTIAL:
      return r.declined > 0
        ? `partial ${name}\t${r.declined} declined, ${r.checked} of ${r.expected} compared`
        : `ok ${name}`;
    case Outcome.NOTHING:
      return `bare ${name}`;
    case Outcome.DISAGREES:
    case Outcome.ABORTED:
    case Outcome.BACKEND_DECLINED:
    case Outcome.INVALID_HIR:
    case Outcome.NO_TYPECHECK:
      return `no ${name}`;
    default:
      return `unmeasured ${name}\t${r.outcome === Outcome.ALL_DECLINED ? "no case was checked: every case declined" : r.first.slice(0, 90)}`;
  }
}

/** Whether two records are the same answer. */
export function same(a, b) {
  // `oracleStopped` is left out: see `classify`.
  return a.outcome === b.outcome && a.checked === b.checked && a.expected === b.expected &&
    a.declined === b.declined && a.timeouts === b.timeouts && a.refused === b.refused &&
    a.answers.join("\n") === b.answers.join("\n");
}

/**
 * FIXED, REGRESSED or CHANGED, for two records that are not `same`.
 *
 * Strictly better is narrow on purpose: an example that trades two declines
 * for one disagreement is not an improvement anybody should read past.
 */
export function attribute(before, after) {
  const agreeing = (r) => AGREEING.has(r.outcome);
  if (agreeing(after) && !agreeing(before)) return "FIXED";
  if (agreeing(before) && !agreeing(after)) return "REGRESSED";
  if (agreeing(before) && agreeing(after)) {
    // Each count in the direction that means "compared more". Fewer lowering
    // refusals and more cases compared is reach; the reverse is reach lost.
    const gains = [
      after.checked - before.checked, before.declined - after.declined,
      before.timeouts - after.timeouts, before.refused - after.refused,
    ];
    if (gains.every((g) => g >= 0) && gains.some((g) => g > 0)) return "FIXED";
    if (gains.every((g) => g <= 0) && gains.some((g) => g < 0)) return "REGRESSED";
  }
  return "CHANGED";
}

/** The comparison as one line: what an example compared, and what it could not. */
export function describe(r) {
  const parts = [r.outcome];
  if (r.expected > 0) parts.push(`${r.checked} of ${r.expected} compared`);
  if (r.declined > 0) parts.push(`${r.declined} declined`);
  if (r.timeouts > 0) parts.push(`${r.timeouts} timed out`);
  if (r.refused > 0) {
    const cascades = r.refused - r.refusedRoots;
    parts.push(`${r.refusedRoots} refused in lowering${cascades > 0 ? ` (${r.refused} with cascades)` : ""}`);
  }
  if (r.oracleStopped > 0) parts.push("node stopped part-way");
  if (r.outcome === Outcome.NOT_MEASURED) parts.push(r.first);
  return parts.join(", ");
}

// **Seen to classify before it is trusted.** Driven with the text `check`
// prints, copied from `tooling/cli/src/main.rs` rather than paraphrased: a test
// inventing its own wording agrees with itself about a format nothing emits.
function selfTest() {
  const agreed = classify(0, "checked 261 cases across 9 function(s)\nagreed on every case\n");
  if (agreed.outcome !== Outcome.AGREES || agreed.checked !== 261 || agreed.expected !== 261) return `a full agreement read as ${JSON.stringify(agreed)}`;
  const partial = classify(0,
    "4 case(s) the compiled program declined -- an index its `!` promised was in range and was not, most often; node answers `undefined` there and the two have nothing to compare\n" +
    "checked 20 of 24 cases; the rest were not reached (a pool value in a loop bound will do that)\nagreed on every case\n");
  if (partial.outcome !== Outcome.PARTIAL || partial.declined !== 4 || partial.checked !== 20 || partial.expected !== 24) return `four declines read as ${JSON.stringify(partial)}`;
  const nothing = classify(0, "nothing to check: no exported function has scalar arguments and a scalar result\n");
  if (nothing.outcome !== Outcome.NOTHING) return `nothing to check read as ${nothing.outcome}`;
  const wrong = classify(1, "checked 3 cases across 1 function(s)\n  nts  f 1 -> 2\n  node f 1 -> 3\nError: 1 case(s) disagree between the compiled program and node\n");
  if (wrong.outcome !== Outcome.DISAGREES || wrong.answers.length !== 2) return `a disagreement read as ${JSON.stringify(wrong)}`;
  const aborted = classify(1, "checked 3 cases across 1 function(s)\n  the compiled program aborted: f 1\nError: the compiled program aborted 1 time(s) for a reason that is not the program correctly declining its input\n");
  if (aborted.outcome !== Outcome.ABORTED || aborted.answers.length !== 1) return `an abort read as ${JSON.stringify(aborted)}`;
  const every = classify(1, "3 case(s) the compiled program declined -- ...\nchecked 0 of 3 cases; the rest were not reached\nError: no case was checked: all 3 declined, so the two sides were never compared.\n");
  // Verbatim, from `examples/a-slot-typed-exactly-undefined`: one root, two cascades.
  const cascaded = classify(0, "  refused: NTS1001 a call inside a `try` whose `throw` would not reach this handler\n" +
    "  refused: NTS1003 `runner` cannot be compiled because it calls `Closure0#call`, and ...\n" +
    "  refused: NTS1003 `awaitedThenRejected` cannot be compiled because it calls `runner`, and ...\n" +
    "checked 87 cases across 3 function(s)\nagreed on every case\n");
  if (cascaded.refused !== 3 || cascaded.refusedRoots !== 1) return `one root and two cascades read as ${cascaded.refusedRoots} of ${cascaded.refused}`;
  if (every.outcome !== Outcome.ALL_DECLINED) return `every case declined read as ${every.outcome}`;
  // Exit 0 without the verdict line is a run that stopped early, not agreement.
  if (classify(0, "checked 3 cases across 1 function(s)\n").outcome !== Outcome.NOT_MEASURED) return "a run with no verdict line read as measured";
  if (classify(1, "Error: failed to start tsgo: No such file or directory\n").outcome !== Outcome.NOT_MEASURED) return "a frontend that never started read as a verdict";
  const regressed = attribute(agreed, { ...agreed, outcome: Outcome.PARTIAL, checked: 257, declined: 4 });
  if (regressed !== "REGRESSED") return `four new declines under an agreement attributed as ${regressed}`;
  const traded = attribute({ ...partial, outcome: Outcome.PARTIAL }, wrong);
  if (traded !== "REGRESSED") return `declines traded for a disagreement attributed as ${traded}`;
  if (attribute(wrong, { ...wrong, answers: ["  nts  f 1 -> 4", "  node f 1 -> 3"] }) !== "CHANGED") return "a different wrong answer was not CHANGED";
  // Verbatim from `node_results` in the differential.
  const stopped = classify(0, "  node stopped part-way: 371 result(s), no `done` line (<--- Last few GCs --->)\n" +
    "checked 361 of 377 cases; the rest were not reached (a pool value in a loop bound will do that)\nagreed on every case\n");
  if (stopped.outcome !== Outcome.PARTIAL || stopped.answers.length !== 0 || stopped.oracleStopped !== 1) return `node stopping read as ${JSON.stringify(stopped)}`;
  const reach = { ...agreed, checked: 87, expected: 87, refused: 3 };
  if (attribute(agreed, reach) !== "REGRESSED") return "three new refusals and fewer cases compared was not REGRESSED";
  if (attribute(reach, agreed) !== "FIXED") return "three refusals cleared and more cases compared was not FIXED";
  if (verdict("x", partial) !== "partial x\t4 declined, 20 of 24 compared") return `a decline projected as ${verdict("x", partial)}`;
  if (verdict("x", { ...partial, declined: 0, timeouts: 3 }) !== "ok x") return "a comparison short only of timeouts is not the gate's ok";
  if (!verdict("x", every).startsWith("unmeasured x\t")) return "every case declined projected as a floor-absorbable verdict";
  if (!verdict("x", classify(1, "error TS2307: Cannot find module\n")).endsWith("needs an installed workspace; cannot resolve here")) return "an unresolved workspace lost its reason";
  return null;
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const broken = selfTest();
if (broken) {
  console.log(`  NOT MEASURED: self-test failed -- ${broken}`);
  process.exit(2);
}
if (args.includes("--self-test")) {
  console.log("  self-test: every outcome classified from verbatim `nts check` text; declines under an agreement attributed as a regression");
  process.exit(0);
}

const verdictsFile = args.find((a) => a.startsWith("--verdicts="))?.slice("--verdicts=".length);
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length).split(",").filter(Boolean);
const binaries = args.filter((a) => !a.startsWith("--"));
if (binaries.length < 1 || binaries.length > 2 || (verdictsFile && binaries.length !== 1)) {
  console.log("  usage: agree.mjs <nts> [<nts-after>] [--only=example,...] [--verdicts=<file>] [--one-change]");
  process.exit(2);
}
if (args.includes("--one-change")) {
  const why = binaries.length === 2 ? oneChange(binaries[0], binaries[1]) : "it compares two binaries and was given one";
  if (why) {
    console.log(`  NOT MEASURED: --one-change, and ${why}`);
    process.exit(2);
  }
}

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
/** Local time, as `ls` and `date` print it on this machine. */
const stamp = (ms) => {
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};
/** Repository-relative inside the tree, absolute outside it. */
const shown = (path) => {
  const rel = relative(ROOT, path);
  return rel === "" || rel.startsWith("..") ? path : rel;
};

/** Copy a binary to a path named by its content, and say what it was. */
function pin(path) {
  const source = resolve(path);
  if (!existsSync(source)) {
    console.log(`  NOT MEASURED: no compiler at ${path}`);
    process.exit(2);
  }
  const { mtimeMs } = statSync(source);
  const hash = sha256(source);
  const dir = join(CACHE, "bin", hash);
  const pinned = join(dir, "nts");
  if (!existsSync(pinned)) {
    mkdirSync(dir, { recursive: true });
    // Through a temporary name, so a run killed mid-copy leaves no truncated
    // binary under a name that claims its hash.
    const partial = join(dir, `nts.${process.pid}.partial`);
    copyFileSync(source, partial);
    chmodSync(partial, 0o755);
    renameSync(partial, pinned);
  }
  // The copy is what runs, so the copy is what is attested: a source
  // rebuilt between the hash and the copy would otherwise run unnamed.
  if (sha256(pinned) !== hash) {
    console.log(`  NOT MEASURED: ${path} changed while it was being pinned; run again`);
    process.exit(2);
  }
  // Marked used, for `prune`.
  const now = new Date();
  utimesSync(dir, now, now);
  return { source: shown(source), hash, built: stamp(mtimeMs), pinned, snapshots: join(dir, "snapshots") };
}

/**
 * Remove pinned binaries, and their snapshot caches, unused for a day and
 * beyond the newest `keep`. A day, so a run another session has in flight
 * never loses the binary it is running.
 */
function prune(keep) {
  const bins = join(CACHE, "bin");
  if (!existsSync(bins)) return;
  const dayAgo = Date.now() - 86_400_000;
  readdirSync(bins)
    .map((name) => ({ path: join(bins, name), used: statSync(join(bins, name)).mtimeMs }))
    .sort((a, b) => b.used - a.used)
    .slice(keep)
    .filter(({ used }) => used < dayAgo)
    .forEach(({ path }) => rmSync(path, { recursive: true, force: true }));
}

const pins = binaries.map(pin);
prune(6);
if (pins.length === 2 && pins[0].hash === pins[1].hash) {
  console.log(`  NOT MEASURED: both arguments are the same binary (sha256 ${pins[0].hash.slice(0, 16)}) --`);
  console.log("  that comparison can only answer \"nothing changed\"");
  process.exit(2);
}

const tsgo = process.env.NTS_TSGO ?? join(ROOT, "target/tsgo");
if (!existsSync(tsgo)) {
  console.log(`  NOT MEASURED: no frontend at ${tsgo}; set NTS_TSGO`);
  process.exit(2);
}

const examples = readdirSync(join(ROOT, "examples"), { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(ROOT, "examples", e.name, "tsconfig.json")))
  .map((e) => e.name)
  .filter((name) => !NOT_DIFFERENTIAL.has(name))
  .filter((name) => !only || only.includes(name))
  .sort();
const unknown = (only ?? []).filter((name) => !examples.includes(name));
if (unknown.length > 0) {
  console.log(`  NOT MEASURED: no such example(s): ${unknown.join(", ")}`);
  process.exit(2);
}
if (examples.length === 0) {
  console.log("  NOT MEASURED: no example to run");
  process.exit(2);
}

// Every temporary file under `~/.cache`, never `/tmp`: `/tmp` here is a tmpfs
// that fills, and runs out of inodes before it runs out of bytes.
mkdirSync(join(CACHE, "tmp"), { recursive: true });
const scratch = mkdtempSync(join(CACHE, "tmp", "run-"));
const env = { ...process.env, NTS_TSGO: tsgo, TMPDIR: scratch };
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(130));

// Each worker is a lowering, a clang build and a node process -- about a gigabyte
// at the top. Cores are rarely what this box runs out of.
const JOBS = Number(process.env.NTS_AGREE_JOBS ??
  Math.max(1, Math.min(8, availableParallelism(), Math.floor(freemem() / 1.5e9))));

/** One `nts check`, classified. */
const check = (pinned, example) =>
  new Promise((done) => {
    const child = spawn(pinned.pinned, ["check", join("examples", example, "tsconfig.json")], {
      cwd: ROOT,
      env: { ...env, NTS_SNAPSHOT_CACHE: pinned.snapshots },
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.on("error", (error) => { clearTimeout(timer); done(classify(null, `${error.message}\n`)); });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      done(classify(signal ? null : status, signal ? `killed by ${signal}\n${out}` : out));
    });
  });

// A count over this glob is a fact about the working tree, not a commit: say
// which examples only this tree has.
const tracked = new Set(
  execFileSync("git", ["ls-files", "-z", "examples/*/tsconfig.json"], { cwd: ROOT, encoding: "utf8" })
    .split("\0").filter(Boolean).map((path) => path.split("/")[1]),
);
const untracked = examples.filter((name) => !tracked.has(name));

const configuration = [
  `backend ${process.env.NTS_BACKEND || "c"}`,
  `rc ${(process.env.NTS_RC ?? "0") !== "0" ? "on" : "off"}`,
  ...((process.env.NTS_POISON ?? "0") !== "0" ? ["poison on"] : []),
].join(", ");
pins.forEach((p, at) => {
  const role = pins.length === 1 ? "nts   " : at === 0 ? "before" : "after ";
  console.log(`  ${role} ${p.source}  sha256 ${p.hash.slice(0, 16)}  built ${p.built}`);
});
if (pins.length === 2) for (const line of armLines(pins[0].source, pins[1].source)) console.log(`  ${line}`);
console.log(`  tsgo   ${shown(resolve(tsgo))}  sha256 ${sha256(tsgo).slice(0, 16)}`);
console.log(`  ${examples.length} example(s), ${JOBS} at a time, ${configuration}`);
if (untracked.length > 0) console.log(`  untracked, in this tree only: ${untracked.join(" ")}`);

const started = Date.now();
/** example -> [record under each binary] */
const runs = new Map();
let next = 0;
await Promise.all(Array.from({ length: Math.min(JOBS, examples.length) }, async () => {
  while (next < examples.length) {
    const example = examples[next++];
    // Both binaries in one worker, one after the other: the frontend's
    // snapshot cache is keyed by project and tsgo, which the two share.
    const records = [];
    for (const p of pins) records.push(await check(p, example));
    runs.set(example, records);
  }
}));

const pad = (s, n) => (s.length >= n ? s : s + " ".repeat(n - s.length));
const width = Math.min(48, Math.max(...examples.map((e) => e.length)) + 2);
const print = (tag, example, line) => console.log(`  ${pad(tag, 13)} ${pad(example, width)} ${line}`);
const printAnswers = (r) => r.answers.slice(0, 6).forEach((line) => console.log(`${" ".repeat(16)}${line}`));

/** Totals over one binary's records: what agreed, and what could not be compared. */
function summarise(records) {
  const by = (o) => records.filter((r) => r.outcome === o).length;
  const sum = (key) => records.reduce((a, r) => a + r[key], 0);
  const unreached = records.reduce((a, r) => a + Math.max(0, r.expected - r.checked - r.declined - r.timeouts), 0);
  const wrong = records.filter((r) => WRONG.has(r.outcome)).length;
  const stopped = records.filter((r) => r.oracleStopped > 0).length;
  console.log(`  ${by(Outcome.AGREES)} agree, ${by(Outcome.PARTIAL)} agree on part of their cases, ` +
    `${by(Outcome.NOTHING)} compared nothing, ${wrong} wrong, ${by(Outcome.NOT_MEASURED)} not measured`);
  console.log(`  ${sum("checked")} of ${sum("expected")} case(s) compared; not compared: ${sum("declined")} declined, ` +
    `${sum("timeouts")} timed out, ${unreached} unreached` +
    (stopped > 0 ? ` (node stopped part-way in ${stopped} example(s))` : ""));
}

const seconds = () => Math.round((Date.now() - started) / 1000);

if (pins.length === 1) {
  if (verdictsFile) writeFileSync(verdictsFile, examples.map((e) => `${verdict(e, runs.get(e)[0])}\n`).join(""));
  const all = examples.map((e) => [e, runs.get(e)[0]]);
  for (const [example, r] of all) {
    if (WRONG.has(r.outcome)) {
      print("WRONG", example, describe(r));
      printAnswers(r);
    }
  }
  for (const [example, r] of all) if (r.outcome === Outcome.PARTIAL) print("partial", example, describe(r));
  for (const [example, r] of all) if (r.outcome === Outcome.NOTHING) print("nothing", example, "exports nothing the differential can drive");
  for (const [example, r] of all) if (r.outcome === Outcome.NOT_MEASURED) print("NOT MEASURED", example, r.first);
  summarise(all.map(([, r]) => r));
  const wrong = all.filter(([, r]) => WRONG.has(r.outcome)).length;
  const unmeasured = all.filter(([, r]) => r.outcome === Outcome.NOT_MEASURED).length;
  console.log(`  ${wrong === 0 && unmeasured === 0 ? "every example that compared anything agrees with node" : `${wrong} wrong, ${unmeasured} not measured`}, in ${seconds()} s`);
  process.exit(wrong > 0 ? 1 : unmeasured > 0 ? 2 : 0);
}

// Two binaries: confirm each difference, then attribute it.
const verdicts = [];
const differing = examples.filter((e) => !same(...runs.get(e)));
for (const example of differing) {
  const [before, after] = runs.get(example);
  const again = [await check(pins[0], example), await check(pins[1], example)];
  if (!same(before, again[0]) || !same(after, again[1])) {
    verdicts.push({ example, tag: "UNSTABLE", before, after, note: !same(before, again[0]) ? "before disagrees with itself" : "after disagrees with itself" });
    continue;
  }
  const tag = before.outcome === Outcome.NOT_MEASURED || after.outcome === Outcome.NOT_MEASURED ? "NOT MEASURED" : attribute(before, after);
  verdicts.push({ example, tag, before, after });
}
const ORDER = ["REGRESSED", "CHANGED", "UNSTABLE", "NOT MEASURED", "FIXED"];
verdicts.sort((a, b) => ORDER.indexOf(a.tag) - ORDER.indexOf(b.tag) || a.example.localeCompare(b.example));
for (const v of verdicts) {
  print(v.tag, v.example, v.note ?? "");
  console.log(`${" ".repeat(16)}before: ${describe(v.before)}`);
  printAnswers(v.before);
  console.log(`${" ".repeat(16)}after:  ${describe(v.after)}`);
  printAnswers(v.after);
}
// Unchanged, and wrong or unmeasurable under both: not this change's answer,
// and not a silence either.
const bothWrong = examples.filter((e) => !differing.includes(e) && WRONG.has(runs.get(e)[1].outcome));
const bothUnmeasured = examples.filter((e) => !differing.includes(e) && runs.get(e)[1].outcome === Outcome.NOT_MEASURED);
for (const e of bothWrong) print("wrong, both", e, describe(runs.get(e)[1]));
for (const e of bothUnmeasured) print("NOT MEASURED", e, `under both: ${runs.get(e)[1].first}`);
console.log("  after:");
summarise(examples.map((e) => runs.get(e)[1]));
const count = (tag) => verdicts.filter((v) => v.tag === tag).length;
const failing = count("REGRESSED") + count("CHANGED") + count("UNSTABLE");
const unmeasured = count("NOT MEASURED") + bothUnmeasured.length;
console.log(`  ${examples.length - differing.length} unchanged, ${count("FIXED")} fixed, ${count("REGRESSED")} regressed, ` +
  `${count("CHANGED")} changed, ${count("UNSTABLE")} unstable, ${unmeasured} not measured, in ${seconds()} s`);
process.exit(failing > 0 ? 1 : unmeasured > 0 ? 2 : 0);
