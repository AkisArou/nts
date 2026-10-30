import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateBatch, formatSummary, parseCells, ensureEmptyOutput } from "./generation.ts";
import type { Cell, ProgramModel } from "./model.ts";
import { CELLS, modelCandidates } from "./scenarios.ts";
import { printProgram } from "./printer.ts";
import { precheckProgram } from "./precheck.ts";
import { loadOracle } from "./oracle.ts";
import { reduceProgram } from "./reduce.ts";
import type { ReductionCandidate } from "./reduce.ts";
import { findingSignature } from "./grouping.ts";
import { json, readProgram, sourceHash, writeProgram } from "./writer.ts";

export const HELP = `Generate proof-directed TypeScript programs (Node 24; run pnpm install first).

  node tooling/census/generate/main.ts --seed <uint32> --count <positive integer> \\
    --cells bounds:call,length:merge,... --out <empty directory>
  node tooling/census/generate/main.ts --reduce <program directory> --oracle <module> \\
    [--out <empty directory>] [--max-candidates <nonnegative integer>]

Generation defaults: --seed 1 --count 10 --cells all. --out is required.
--count counts attempts; failed prechecks are dropped and counted by reason.
Cells: ${CELLS.join(",")}

Reduction writes <program directory>.reduced unless --out is supplied.
The oracle module exports evaluate(request), or default { evaluate }.
It supplies nts CheckReport measurements and control shortcut evidence for
c, llvm and jvm. This tool does not run nts or supply a compiler verdict.
The default reduction budget is 500 candidates; exhaustion is reported.
`;

export type Command =
  | { mode: "help" }
  | { mode: "generate"; seed: number; count: number; cells: Cell[]; out: string }
  | { mode: "reduce"; directory: string; oracle: string; out: string; maxCandidates: number };

function natural(value: string, flag: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} requires a decimal integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${flag} must be in ${minimum}..${maximum}`);
  }
  return number;
}
export function parseArguments(args: string[]): Command {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) return { mode: "help" };
  const values = new Map<string, string>();
  const allowed = new Set(["--seed", "--count", "--cells", "--out", "--reduce", "--oracle", "--max-candidates"]);
  for (let at = 0; at < args.length; at += 2) {
    const flag = args[at], value = args[at + 1];
    if (!allowed.has(flag)) throw new Error(`unknown option: ${flag}`);
    if (values.has(flag)) throw new Error(`duplicate option: ${flag}`);
    if (value === undefined || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
    values.set(flag, value);
  }
  const directory = values.get("--reduce");
  if (directory !== undefined) {
    if (["--seed", "--count", "--cells"].some((flag) => values.has(flag))) {
      throw new Error("--reduce does not accept generation options");
    }
    const oracle = values.get("--oracle");
    if (!oracle) throw new Error("--reduce requires --oracle <module>");
    return { mode: "reduce", directory: resolve(directory), oracle: resolve(oracle),
      out: resolve(values.get("--out") ?? `${directory}.reduced`),
      maxCandidates: natural(values.get("--max-candidates") ?? "500", "--max-candidates", 0) };
  }
  if (values.has("--oracle") || values.has("--max-candidates")) throw new Error("oracle and reduction budget options require --reduce");
  const out = values.get("--out");
  if (!out) throw new Error("generation requires --out <empty directory>");
  return { mode: "generate", seed: natural(values.get("--seed") ?? "1", "--seed", 0, 0xffff_ffff),
    count: natural(values.get("--count") ?? "10", "--count", 1),
    cells: parseCells(values.get("--cells") ?? "all"), out: resolve(out) };
}

export async function reduceDirectory(options: Extract<Command, { mode: "reduce" }>): Promise<void> {
  const initial = readProgram(options.directory);
  if (options.out === options.directory) throw new Error("reduction output must be a separate directory");
  const oracle = await loadOracle(options.oracle);
  ensureEmptyOutput(options.out);
  const scratch = mkdtempSync(join(tmpdir(), "nts-census-reduce-"));
  const materialize = (candidate: ReductionCandidate<ProgramModel>) =>
    writeProgram(scratch, candidate.model, { source: candidate.source });
  try {
    const reduced = await reduceProgram({
      initial: { model: initial.model, source: initial.source },
      // Edited/reduced source is the evidence: do not replace it by an invented
      // reconstruction just because its predecessor's model is still available.
      modelCandidates: initial.manifest.sourcePhase === "model" ? modelCandidates : () => [],
      print: (model) => printProgram(model).source,
      async precheck(candidate) {
        const { printed } = materialize(candidate);
        const checked = precheckProgram(scratch, printed.functions);
        return checked.ok ? { ok: true } : { ok: false, reason: checked.reason };
      },
      request(candidate) {
        const { printed } = materialize(candidate);
        return { directory: scratch, source: candidate.source, cell: candidate.model.cell,
          template: candidate.model.template, functions: printed.functions, backends: ["c", "llvm", "jvm"] };
      },
      oracle, maxCandidates: options.maxCandidates,
    });
    const output = writeProgram(options.out, reduced.model, { source: reduced.source });
    const final = precheckProgram(options.out, output.printed.functions);
    if (!final.ok) throw new Error(`written reduction failed ${final.reason}: ${final.detail}`);
    writeProgram(options.out, reduced.model, { source: reduced.source, distinguishingInputs: final.distinguishingInputs });
    const grouping = findingSignature({ ...reduced.signature, source: reduced.source });
    writeFileSync(join(options.out, "reduction.json"), json({
      version: 1, originalSourceHash: sourceHash(initial.source), sourceHash: sourceHash(reduced.source),
      signature: reduced.signature, grouping, stats: reduced.stats, oracle: reduced.observation,
    }));
    console.log(`reduced ${initial.source.length} to ${reduced.source.length} source characters`);
    console.log(`${reduced.stats.accepted}/${reduced.stats.attempted} candidates retained; model=${reduced.stats.modelAccepted}, text=${reduced.stats.textAccepted}`);
    if (reduced.stats.budgetExhausted) console.log("candidate budget exhausted; this is a validated reduction, not a claim of minimality");
    console.log(`program hash: ${grouping.programHash}`);
    console.log(`output: ${options.out}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const command = parseArguments(args);
  if (command.mode === "help") { console.log(HELP); return; }
  if (command.mode === "reduce") { await reduceDirectory(command); return; }
  const summary = generateBatch({ ...command, onProgress(progress) {
    if (progress.attempted % 25 === 0 && progress.attempted < progress.requested) {
      console.error(`checked ${progress.attempted}/${progress.requested}; kept ${progress.written}`);
    }
  } });
  console.log(formatSummary(summary));
  console.log(`output: ${command.out}`);
  if (summary.written === 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
