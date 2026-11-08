// Whole resident-worker aggregates only; partial test scopes cannot calibrate a step.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CENSUS_STEPS = ["test262-cases", "test262-builtins-cases", "test262-rest-cases",
  "test262-jvm", "test262-llvm", "typescript-c", "typescript-llvm", "typescript-jvm"] as const;
const GIB = 2 ** 30;
type Peak = { run: string; verdict: string; workers: number; elastic: boolean; peak_bytes: number };

export function calibratedGiB(peakBytes: number): number {
  if (!Number.isSafeInteger(peakBytes) || peakBytes <= 0) throw new Error("a measured positive byte peak is required");
  return Math.ceil(Math.max(2 * peakBytes / GIB, peakBytes / GIB + 1));
}

export function recommendation(observations: Peak[], targetWorkers: number): number {
  if (!Number.isInteger(targetWorkers) || targetWorkers <= 0) throw new Error("invalid target workers");
  if (observations.some(o => !Number.isInteger(o.workers) || o.workers <= 0)) throw new Error("invalid granted workers");
  if (new Set(observations.filter(o => o.verdict === "green").map(o => o.run)).size < 3) {
    throw new Error("at least three distinct green runs are required");
  }
  if (observations.some(o => !Number.isSafeInteger(o.peak_bytes) || o.peak_bytes <= 0)) throw new Error("invalid peak");
  // Headroom comes from green runs, normalized to the target worker count.
  // Every raw historical peak remains a floor, including red observations.
  const peak = Math.max(...observations.filter(o => o.verdict === "green")
    .map(o => o.elastic ? o.peak_bytes * targetWorkers / o.workers : o.peak_bytes));
  const historical = Math.max(...observations.map(o => o.peak_bytes));
  return Math.max(calibratedGiB(Math.ceil(peak)), Math.ceil(historical / GIB));
}

export function memoryWarning(peakBytes: number | null, budgetBytes: number | null): string | null {
  if (peakBytes === null || budgetBytes === null || !Number.isFinite(peakBytes) || !Number.isFinite(budgetBytes)
    || budgetBytes <= 0 || peakBytes <= budgetBytes / 2) return null;
  return `aggregate memory peak ${(peakBytes / GIB).toFixed(3)} GiB exceeds half the ${(budgetBytes / GIB).toFixed(3)} GiB reservation; recalibrate`;
}

// Inputs are the actual gate summaries, including older/red observations so
// a historical high-water mark is never erased by selecting green samples.
export function calibration(inputs: { run: string; summary: any; sha256: string }[], previous?: any) {
  if (previous && (previous.version !== 2 || !Array.isArray(previous.rows) || !Array.isArray(previous.runs))) throw new Error("invalid previous calibration");
  const unique = new Map(inputs.map(i => [i.run, i]));
  for (const input of unique.values()) {
    const old = previous?.runs.find((t: any) => t.run === input.run);
    if (old && old.summary_sha256 !== input.sha256) throw new Error(`historical run changed: ${input.run}`);
  }
  const rows = CENSUS_STEPS.map(step => {
    const fresh = [...unique.values()].flatMap(({ run, summary }) => {
      const record = summary.steps.find((s: any) => s.name === step);
      const aggregate = summary.case_costs?.steps?.[step]?.aggregate_memory;
      if (!record || aggregate?.max_scope_peak_bytes == null) return [];
      // An elastic step starts all its workers, and its tokens decide how many
      // cases ran at once: its peak is normalized by the tokens it held, and
      // the reservation is still sized for every worker it may run (`slots`).
      const elastic = record.elastic === true;
      return [{ run, verdict: summary.verdict, workers: elastic ? record.peak_tokens : record.slots, slots: record.slots, elastic,
        peak_bytes: aggregate.max_scope_peak_bytes, scope_peaks_bytes: aggregate.scopes.map((s: any) => s.peak_bytes),
        reserved_bytes: aggregate.reserved_step_mem_bytes }];
    });
    const retained = previous?.rows.find((r: any) => r.step === step)?.observations ?? [];
    const observations: typeof fresh = [...new Map([...retained, ...fresh].map(o => [o.run, o])).values()];
    // Observations recorded before `slots` was kept were all fixed grants.
    const workers = Math.max(...observations.map(o => o.slots ?? o.workers));
    return { step, workers, mem_gib: recommendation(observations, workers), observations };
  });
  return { version: 2, rule: "ceil(max(2 * peak, peak + 1 GiB)); normalize elastic workers; retain every historical peak",
    coverage: "resident-worker aggregate, excluding its outside orchestrator; no partial-scope or unmeasured step is calibrated",
    runs: [...new Map([...(previous?.runs ?? []), ...[...unique.values()].map(({ run, summary, sha256 }) =>
      ({ run, commit: summary.identities.commit, verdict: summary.verdict, summary_sha256: sha256 }))].map(t => [t.run, t])).values()], rows };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output, ...paths] = process.argv.slice(2);
  if (!output || paths.length < 3) throw new Error("usage: memory-calibration.ts <output.json> <summary.json>...");
  const inputs = paths.map(input => { const path = realpathSync(input), text = readFileSync(path, "utf8"); return {
    run: basename(dirname(path)), summary: JSON.parse(text), sha256: createHash("sha256").update(text).digest("hex") }; });
  const previous = existsSync(output) ? JSON.parse(readFileSync(output, "utf8")) : undefined;
  writeFileSync(output, JSON.stringify(calibration(inputs, previous), null, 2) + "\n");
}
