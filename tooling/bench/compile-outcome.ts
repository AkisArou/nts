// A benchmark's recorded compile outcome, for a shell runner: the same fact the
// benches step records (results/benchmarks/<backend>/outcomes.tsv, scope
// compile), read through outcomes.ts's own parser.
//
//   node tooling/bench/compile-outcome.ts timeout|decline <backend> benchmarks/cases/<name>
//
// judges a compile that timed out, or one that declined the program (it
// produced nothing), against the benchmark's row and prints one line:
//   as recorded                         the row records that timeout
//   as recorded: the record says <kind> the row records no passing compile either (a decline)
//   pending: <case> is not recorded ... the row is not written yet (records/pending.ts)
//   worse: the record says <kind>       the row records something better
// It exits 0 with a judgement, 2 when the arguments or the record are not usable.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pendingLine } from "../records/pending.ts";
import { compileRecordPath, judgeCompileDecline, judgeCompileTimeout, parseBenchmarkRecord, recordedCompileOutcome } from "./outcomes.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type Backend = "c" | "llvm" | "jvm";

function recorded(root: string, backend: Backend, path: string) {
  const file = compileRecordPath(backend);
  return { file, outcome: recordedCompileOutcome(parseBenchmarkRecord(readFileSync(join(root, file), "utf8")), path) };
}

/** The line this prints for a compile timeout of `path` on `backend`, from the tree at `root`. */
export function compileTimeoutLine(root: string, backend: Backend, path: string): string {
  const { file, outcome } = recorded(root, backend, path), judged = judgeCompileTimeout(outcome);
  return judged === "pending" ? pendingLine(path, file) : judged === "worse" ? `worse: the record says ${outcome!.kind}` : judged;
}

/** The line this prints for a compile of `path` on `backend` that declined the program, from the tree at `root`. */
export function compileDeclineLine(root: string, backend: Backend, path: string): string {
  const { file, outcome } = recorded(root, backend, path), judged = judgeCompileDecline(outcome);
  return judged === "pending" ? pendingLine(path, file) : `${judged}: the record says ${outcome!.kind}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, backend, path, ...extra] = process.argv.slice(2);
  try {
    if (!(command === "timeout" || command === "decline") || !(backend === "c" || backend === "llvm" || backend === "jvm") || !path?.startsWith("benchmarks/cases/") || extra.length) {
      throw new Error("usage: compile-outcome.ts timeout|decline c|llvm|jvm benchmarks/cases/<name>");
    }
    console.log((command === "timeout" ? compileTimeoutLine : compileDeclineLine)(ROOT, backend, path));
  } catch (error) {
    console.error(`compile-outcome.ts: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
