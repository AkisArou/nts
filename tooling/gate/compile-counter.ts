// Scope changes invalidate old baselines and kept listings. Inheritance covers
// the exec's threads and descendants; the runtime hir population has no child
// processes. CPU is perf's waited-command user+sys rusage in that same scope.
export const COUNTER_SCOPE = "exec-inherited-user-instructions-v1";

export interface CounterRow {
  counter_scope?: unknown;
  instructions?: number | null;
  cpu_s?: number | null;
  counter_error?: string | null;
  error?: string | null;
  status?: number | null;
  signal?: string | null;
}

export function counterProblem(row: CounterRow): string | null {
  if (row.error || row.counter_error) return row.error || row.counter_error || null;
  if (row.counter_scope !== COUNTER_SCOPE) return "incompatible counter scope (old attached counts are not measurements)";
  if (row.signal || (row.status !== undefined && row.status !== 0)) return `counter run ended ${row.signal ?? row.status}`;
  const { instructions, cpu_s } = row;
  if (typeof instructions !== "number" || !Number.isFinite(instructions) || instructions <= 0) return "no positive instruction count";
  if (typeof cpu_s !== "number" || !Number.isFinite(cpu_s) || cpu_s <= 0) return "no waited-command CPU measurement";
  // A deliberately broad floor, far below this corpus's billions/s. It rejects
  // the observed missed-worker reading (319,570 instructions / 92.90 CPU-s)
  // even though perf reported success and 100% counter running time.
  if (instructions / cpu_s < 1_000_000) return `implausible instruction count (${instructions} instructions / ${cpu_s.toFixed(6)} CPU-s)`;
  return null;
}

export function readCounterTable(text: string) {
  if (!text.split("\n").includes(`# counter-scope: ${COUNTER_SCOPE}`)) throw new Error("incompatible compile-times.tsv counter scope; record a fresh five-repeat baseline");
  const rows = new Map<string, number>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [module, g] = line.split("\t");
    if (!module || !Number.isFinite(Number(g)) || !(Number(g) > 0)) throw new Error(`invalid baseline row: ${line}`);
    if (rows.has(module)) throw new Error(`duplicate baseline row: ${module}`);
    rows.set(module, Number(g));
  }
  const number = (name: string) => Number(text.split("\n").find(line => line.startsWith(`# ${name}: `))?.split(": ")[1]);
  const ratio = number("regression-ratio");
  if (!Number.isFinite(ratio) || ratio <= 1) throw new Error("missing or invalid calibrated relative threshold");
  if (text.includes("# regression-absolute-g:")) throw new Error("obsolete absolute-floor policy; record the relative-only baseline");
  return { rows, ratio };
}

export interface CalibrationRun extends CounterRow {
  module: string;
  repeat: number;
  listing_functions: number | null;
  listing_definitions: number;
  counter_file: string;
}
export interface Calibration {
  counter_scope: string;
  complete: boolean;
  nts_sha256: string;
  modules: { module: string; runs: CalibrationRun[] }[];
}

/** Publish only a full five-repeat population. The baseline is the median;
 * the ratio clears four times the measured max/min spread, with a 10% floor,
 * rounded up to 5 percentage points. There is no absolute floor: small-module
 * blow-ups must also fail. Raw measurements stay with the policy in results/.
 */
export function calibratedTable(summary: Calibration, expected: string[]) {
  if (!summary.complete || summary.counter_scope !== COUNTER_SCOPE || !/^[a-f0-9]{64}$/.test(summary.nts_sha256)) throw new Error("incomplete or incompatible calibration");
  const modules = [...summary.modules].sort((a, b) => a.module < b.module ? -1 : a.module > b.module ? 1 : 0);
  if (JSON.stringify(modules.map(m => m.module)) !== JSON.stringify([...expected].sort())) throw new Error("calibration population differs from the current runtime modules");
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[2];
  let maxSpread = 0;
  const rows = modules.map(({ module, runs }) => {
    if (runs.length !== 5 || runs.some(r => r.module !== module || r.status !== 0 || counterProblem(r) !== null)
      || JSON.stringify(runs.map(r => r.repeat).sort()) !== "[1,2,3,4,5]"
      || runs.some(r => !Number.isInteger(r.listing_functions) || r.listing_functions! < 1 || r.listing_functions !== r.listing_definitions)
      || new Set(runs.map(r => r.listing_functions)).size !== 1) throw new Error(`incomplete five-repeat listing/count proof: ${module}`);
    const counts = runs.map(r => r.instructions!);
    maxSpread = Math.max(maxSpread, Math.max(...counts) / Math.min(...counts) - 1);
    return `${module}\t${(median(counts) / 1e9).toFixed(3)}\t${median(runs.map(r => r.cpu_s!)).toFixed(3)}`;
  });
  const ratio = 1 + Math.max(2, Math.ceil(80 * maxSpread)) / 20;
  const policy = { ratio, observed_max_spread: maxSpread, spread_multiplier: 4, relative_floor: 0.10 };
  const text = [`# counter-scope: ${COUNTER_SCOPE}`, `# compiler-sha256: ${summary.nts_sha256}`,
    `# regression-ratio: ${ratio.toFixed(2)}`,
    "# Five-repeat medians; policy/evidence: results/compile-counter-calibration.json",
    "# Rerecord with node tooling/gate/compile-time.mjs --record; explain why.",
    "# module\tG user instructions (all threads/descendants from exec)\tCPU s", ...rows, ""].join("\n");
  return { text, policy };
}
