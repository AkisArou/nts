// The dex step's record (results/dex/outcomes.tsv): whether d8 accepts the
// classes emit-jvm writes for each example and bench case, one row per target
// that reached d8. A compile that declined or timed out reached no d8, and is
// judged against its compile record instead (tooling/android/dexes.sh).
//
// A target with no row is pending: listed, not failed, and the full check
// writes its row after landing (tooling/records/record-pending.ts). The
// outcome is the shared ratchet's (outcome-transition.ts): d8 accepting a
// target is a pass, d8 refusing one is a loud build failure with d8's message.
// So a refusal the row records holds, a refusal where the row says pass is
// red, an acceptance where it records a refusal is FIXED and rewritten, and a
// refusal with another message is a change, and red.
//
//   node tooling/android/dex-record.ts targets                     every target a full run dexes
//   node tooling/android/dex-record.ts judge <work> [--full] <target ...>   what d8 did, against the record
//   node tooling/android/dex-record.ts write <work> <target ...>   the pending rows and the accepted changes
//   node tooling/android/dex-record.ts record-pending              the full check's recorder: dex what can change a row, then write
//
// <work> is dexes.sh's work directory: a target's d8 exit status is in
// <work>/<key>/d8.status and its log in <work>/<key>/d8.log, the key being the
// target's path with each `/` as `_`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mergeLineRecord, parseLineRecord, serializeLineRecord, type LineRecordFormat } from "../census/line-record.ts";
import { acceptedChange, outcomeDisposition, outcomeTransition, type OutcomeTransition } from "../conformance/outcome-transition.ts";
import { acceptedLine, inventory, pendingLine } from "../records/pending.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DEX_RECORD = "results/dex/outcomes.tsv";

export type DexOutcome = { kind: "pass" } | { kind: "build-failure"; diagnostic: string };
type Row = { outcome: DexOutcome };
type Metadata = { version: 1 };

const FORMAT: LineRecordFormat<Metadata, Row> = {
  prefix: "# nts-dex-outcomes ",
  label: "dex",
  metadata(value) { assert.deepEqual(value, { version: 1 }, "unknown dex record header"); return { version: 1 }; },
  row(path, value) {
    const outcome = (value as Row | null)?.outcome;
    assert.ok(path.startsWith("tests/programs/") || path.startsWith("benchmarks/cases/"), `not a dex target: ${path}`);
    if (outcome?.kind === "pass") assert.deepEqual(Object.keys(value as object), ["outcome"], `malformed dex row: ${path}`);
    else assert.ok(outcome?.kind === "build-failure" && typeof outcome.diagnostic === "string" && outcome.diagnostic !== "", `malformed dex row: ${path}`);
    return { outcome: outcome.kind === "pass" ? { kind: "pass" } : { kind: "build-failure", diagnostic: outcome.diagnostic } };
  },
  key: path => path,
};

/**
 * Every target a full run dexes, sorted: each example (a directory of
 * tests/programs/ with its own tsconfig.json) and each bench case.
 *
 * **`invalid` and `unsupported` are excluded, as `backend_examples` excludes
 * them.** `invalid` exists to fail typechecking, so the backend declining it is
 * the example working; counted, it made `1 declined` a permanent fixture, and a
 * permanent fixture is what a real decline would have hidden behind.
 *
 * **An example is a directory with a `tsconfig.json`, not any directory under
 * tests/programs/.** `tests/interop` and `tests/workspace` are containers, of
 * seventeen projects and four packages: compiled as one program each, they
 * declined every run for being containers (TS2300 Duplicate identifier
 * 'Drawable'; TS2307 Cannot find module '@workspace/notifications'). A bench
 * case has no tsconfig of its own; dexes.sh writes one.
 */
export function dexTargets(root: string): string[] {
  const directories = (under: string) => !existsSync(join(root, under)) ? [] :
    readdirSync(join(root, under), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => `${under}/${entry.name}`);
  return [...directories("tests/programs").filter(path => existsSync(join(root, path, "tsconfig.json"))), ...directories("benchmarks/cases")]
    .filter(path => !/\/(invalid|unsupported)$/.test(path)).sort();
}

/**
 * d8's message for a refusal, stable across runs: the line after its
 * `Error in <class file>:`, without the work directory, which names the run,
 * and without the leading exception class, which d8 obfuscates by release.
 */
export function d8Diagnostic(log: string, work: string): string {
  const lines = log.split("\n").map(line => line.trim()).filter(Boolean);
  const at = lines.findIndex(line => line.startsWith("Error in "));
  const message = (at >= 0 ? lines[at + 1] : lines[0]) ?? "d8 exited without a message";
  return message.replaceAll(`${work}/`, "").replace(/^[\w.$]+: /, "");
}

/** What d8 did for each target that reached it in the run whose work directory is `work`. */
export function observed(work: string, targets: readonly string[]): Map<string, DexOutcome> {
  const seen = new Map<string, DexOutcome>();
  for (const target of targets) {
    const out = join(work, target.replaceAll("/", "_")), status = join(out, "d8.status");
    if (!existsSync(status)) continue;
    const code = readFileSync(status, "utf8").trim();
    assert.match(code, /^\d+$/, `unreadable d8 status: ${status}`);
    seen.set(target, code === "0" ? { kind: "pass" } : { kind: "build-failure", diagnostic: d8Diagnostic(readFileSync(join(out, "d8.log"), "utf8"), work) });
  }
  return seen;
}

/** The paths the record has rows for. */
export const recordedTargets = (text: string): string[] => parseLineRecord(text, FORMAT).rows.map(row => row.path);
/** Each row's target and outcome, for the conformance summary (tooling/records/summary.ts). */
export const recordedOutcomes = (text: string): { path: string; outcome: DexOutcome }[] =>
  parseLineRecord(text, FORMAT).rows.map(row => ({ path: row.path, outcome: row.value.outcome }));
/** One row's outcome, checked as the record's reader checks it. */
export const dexOutcome = (path: string, value: unknown): DexOutcome => FORMAT.row(path, value, { version: 1 }).outcome;

/** How the shared ratchet takes a change of a target's outcome. */
export function compareDex(before: DexOutcome, after: DexOutcome): OutcomeTransition {
  return outcomeTransition(outcomeDisposition(before.kind), outcomeDisposition(after.kind), isDeepStrictEqual(before, after));
}
const says = (outcome: DexOutcome) => outcome.kind === "pass" ? "d8 accepts it" : `d8 refuses it: ${outcome.diagnostic}`;

export type Judgement = { lines: string[]; failed: number; updates: { path: string; value: Row }[] };
/**
 * The run's outcomes against the record's rows (null when there is no record
 * yet). On a full run, `targets` is every target, and a row for a path that is
 * no longer one is stale: the change that removes a target deletes its row.
 */
export function judge(record: string | null, seen: ReadonlyMap<string, DexOutcome>, targets: readonly string[], full: boolean): Judgement {
  const rows = new Map((record === null ? [] : parseLineRecord(record, FORMAT).rows).map(row => [row.path, row.value.outcome]));
  const result: Judgement = { lines: [], failed: 0, updates: [] };
  for (const [target, now] of seen) {
    const was = rows.get(target);
    if (!was) { result.lines.push(`${pendingLine(target, DEX_RECORD)}: ${says(now)}`); result.updates.push({ path: target, value: { outcome: now } }); continue; }
    const transition = compareDex(was, now);
    if (transition.word === "holds" || transition.word === "reproduces") {
      if (now.kind !== "pass") result.lines.push(`${target}: ${says(now)}, as its dex record says`);
      continue;
    }
    if (acceptedChange(transition)) {
      result.lines.push(acceptedLine(transition, target, DEX_RECORD, JSON.stringify(was), JSON.stringify(now)));
      result.updates.push({ path: target, value: { outcome: now } });
      continue;
    }
    result.lines.push(`${target}: ${transition.word}: ${says(now)}, where its dex record says: ${says(was)}`);
    if (!transition.ok) result.failed++;
  }
  if (full) for (const path of inventory(rows.keys(), targets).stale) {
    result.lines.push(`${path}: recorded in ${DEX_RECORD} but no longer a target; the change that removes a target deletes its row`);
    result.failed++;
  }
  return result;
}

/** The record with the judgement's rows written in, every other line byte for byte. */
export function written(record: string | null, updates: Judgement["updates"]): string {
  if (record !== null) return updates.length ? mergeLineRecord(record, updates, FORMAT) : record;
  return serializeLineRecord({ metadata: { version: 1 }, rows: updates }, FORMAT);
}

function main(argv: readonly string[]): number {
  const [command, ...rest] = argv, file = join(ROOT, DEX_RECORD);
  const record = () => existsSync(file) ? readFileSync(file, "utf8") : null;
  if (command === "targets" && rest.length === 0) { for (const target of dexTargets(ROOT)) console.log(target); return 0; }
  if (command === "record-pending" && rest.length === 0) {
    // Only a target with no row, or one whose row records a refusal, can get a
    // row written: a pass that turns into a refusal is red, never recorded.
    // dexes.sh dexes those alone and ends by calling `write` (NTS_DEX_RECORD=pending).
    const text = record(), rows = text === null ? [] : parseLineRecord(text, FORMAT).rows;
    const targets = [...inventory(rows.map(row => row.path), dexTargets(ROOT)).pending,
      ...rows.filter(row => row.value.outcome.kind !== "pass").map(row => row.path)].sort();
    if (!targets.length) { console.log(`dex: no target is pending and ${DEX_RECORD} records no refusal`); return 0; }
    return spawnSync("sh", [join(ROOT, "tooling/android/dexes.sh"), ...targets], { cwd: ROOT, stdio: "inherit", env: { ...process.env, NTS_DEX_RECORD: "pending" } }).status ?? 1;
  }
  if ((command === "judge" || command === "write") && rest.length >= 2) {
    const [work, ...more] = rest as [string, ...string[]];
    const full = more[0] === "--full", targets = full ? more.slice(1) : more;
    const judged = judge(record(), observed(work, targets), targets, full);
    for (const line of judged.lines) console.log(line);
    if (command === "judge") {
      if (judged.failed) console.error(`${judged.failed} target(s) worse than the dex record (${DEX_RECORD}), each named above`);
      return judged.failed ? 1 : 0;
    }
    if (!judged.updates.length) return 0;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, written(record(), judged.updates));
    console.log(`wrote ${judged.updates.length} row(s) into ${DEX_RECORD}`);
    return 0;
  }
  console.error("usage: dex-record.ts targets | judge <work> [--full] <target ...> | write <work> <target ...> | record-pending");
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
