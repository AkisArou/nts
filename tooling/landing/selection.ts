// What a change's landing check runs, and what it leaves to the full check.
//
// The rules (tooling/gate/owed.mjs) say which gate steps a change owes. Each
// step has a landing form in owed.mjs's LANDING table, beside the rules; this
// module maps the owed steps through it, estimates what the result costs on
// this machine, and moves the costliest steps that may move to the full check
// until the estimate fits the budget (docs/workflow.md, "Landing: the landing
// check": ten minutes or less).
//
// **The estimate is each step's recorded CPU over the width it can use**, as
// the gate's scheduler ranks steps (step-scheduling.ts). Measured by the
// landing check itself, a step's width is the parallelism it reached there:
// an incremental build is a chain of crates and reaches about a third of its
// eight slots. Measured only by a full gate, whose walls stretch with its
// contention, it is what its row in the step table grants, or what it was
// seen to reach when that is more -- `tooling` holds one slot and runs its
// test files side by side. The selection costs
//
//   build + max(work / slots, the longest step)
//
// because the landing check builds the compiler before any step runs (the
// steps drive it), and the rest share the run's slots. A step never measured
// costs what the gate assumes of one, a minute at its full width.
//
// **A prerequisite runs with every step that needs it** (a row's `needs`):
// it joins the landing steps, it cannot move while a step that never moves
// needs it, and moving a step to the full check moves every step that needs
// it. A prerequisite nothing left needs goes too.
//
// The full check reads `deferredSteps` for what a landing left to it.
import { readFileSync } from "node:fs";
import { usableWidth } from "../gate/step-scheduling.ts";

export type Form =
  | { form: "tree" }
  | { form: "as-is" }
  | { form: "fixtures"; corpora: readonly string[] }
  | { form: "sample"; sample: string }
  | { form: "after" };
export type Table = Readonly<Record<string, Form>>;
/** A step's row in tooling/gate/step-table.mjs, as far as the selection reads it. */
export type StepRow = { readonly name: string; readonly slots?: number; readonly fe?: boolean; readonly needs?: readonly string[] };
/**
 * What the rules select for a range (owed-range.ts): the steps a landing owes,
 * or every step all.sh defines, and `reach`, every step the rules name, the
 * wide ones included, which a landing leaves to the full check.
 */
export type Owed = { steps: readonly string[] | "all"; reach?: readonly string[]; interop?: string | null; doctests?: string | null };

/** Every step the rules reach: what they name, or every step when one owes the full gate. */
export function owedReach(rules: readonly { steps: readonly string[]; full?: boolean }[], catalogue: readonly string[]): string[] {
  return rules.some(r => r.full) ? [...catalogue] : [...new Set(rules.flatMap(r => r.steps))];
}
export type Budget = { slots: number; frontends: number; seconds: number };
/** A step's recorded cost. `source` says where it was read; `measured` is false for the default. */
export type StepCost = { cpu: number; wall?: number; measured: boolean; source: string };

export type Landing = {
  step: string; form: "tree" | "as-is" | "fixtures" | "sample" | "prerequisite";
  /** For a sampled step, the owed steps it stands for. */
  for?: string[];
  seconds: number; cost: StepCost;
};
export type Why = "after landing" | "not its own fixtures" | "sample not built yet" | "over the budget" | "no landing form";
export type Deferred = { step: string; why: Why; sample?: string };
export type Estimate = {
  seconds: number; build: number; work: number; longest: number; longestStep: string | null;
  /** What the steps that never move cost alone: above the budget, nothing deferrable is to blame. */
  fixed: number;
};
export type Selection = { owed: string[]; landing: Landing[]; deferred: Deferred[]; estimate: Estimate; budget: Budget; fits: boolean };

export type SelectionInput = {
  owed: Owed;
  /** Every path the change touches, both sides of a rename. */
  paths: readonly string[];
  catalogue: readonly string[];
  table: Table;
  inCorpus: (corpus: string, path: string) => boolean;
  rows: ReadonlyMap<string, StepRow>;
  cost: (step: string) => StepCost;
  budget: Budget;
};

/** The steps that never move to the full check. */
const FIXED = new Set(["tree", "as-is"]);

export function landingSelection(input: SelectionInput): Selection {
  const owed = input.owed.steps === "all" ? [...input.catalogue] : [...input.owed.steps];
  const deferred: Deferred[] = [];
  const chosen = new Map<string, Landing>();
  const land = (step: string, form: Landing["form"], owedStep?: string) => {
    const known = chosen.get(step);
    if (known) { if (owedStep) known.for = [...(known.for ?? []), owedStep]; return; }
    const cost = input.cost(step);
    chosen.set(step, { step, form, ...(owedStep ? { for: [owedStep] } : {}), cost, seconds: stepSeconds(cost, input.rows.get(step), input.budget) });
  };
  for (const step of owed) {
    const row = input.table[step];
    if (!row) { deferred.push({ step, why: "no landing form" }); continue; }
    if (row.form === "tree" || row.form === "as-is") land(step, row.form);
    else if (row.form === "fixtures") {
      if (input.paths.some(path => row.corpora.some(corpus => input.inCorpus(corpus, path)))) land(step, "fixtures");
      else deferred.push({ step, why: "not its own fixtures" });
    } else if (row.form === "sample") {
      if (input.catalogue.includes(row.sample)) land(row.sample, "sample", step);
      else deferred.push({ step, why: "sample not built yet", sample: row.sample });
    } else deferred.push({ step, why: "after landing" });
  }
  const needs = (step: string): readonly string[] => input.rows.get(step)?.needs ?? [];
  for (const queue = [...chosen.keys()]; queue.length;) {
    const step = queue.shift()!;
    for (const prerequisite of needs(step)) {
      if (chosen.has(prerequisite)) continue;
      // A step that cannot run is refused here, never handed to the runner to wait on.
      if (!input.catalogue.includes(prerequisite)) throw new Error(`${step} needs ${prerequisite}, which all.sh does not define`);
      land(prerequisite, "prerequisite");
      queue.push(prerequisite);
    }
  }
  // A step that never moves fixes what it needs in place.
  const fixed = new Set<string>();
  const fix = (step: string): void => { if (fixed.has(step)) return; fixed.add(step); for (const p of needs(step)) if (chosen.has(p)) fix(p); };
  for (const s of chosen.values()) if (FIXED.has(s.form)) fix(s.step);

  const steps = [...chosen.values()];
  const cost = (names: ReadonlySet<string>) => estimate(steps.filter(s => names.has(s.step)), input.budget);
  // Moving `step` moves what needs it, and the prerequisites nothing kept needs.
  const without = (step: string, kept: ReadonlySet<string>): Set<string> => {
    const gone = new Set([step]);
    for (let grew = true; grew;) {
      grew = false;
      for (const name of kept) if (!gone.has(name) && needs(name).some(p => gone.has(p))) { gone.add(name); grew = true; }
    }
    const left = new Set([...kept].filter(name => !gone.has(name)));
    for (let dropped = true; dropped;) {
      dropped = false;
      for (const name of left) if (chosen.get(name)!.form === "prerequisite" && ![...left].some(other => needs(other).includes(name))) { left.delete(name); dropped = true; }
    }
    return left;
  };
  // Putting `step` back brings what it needs.
  const withStep = (step: string, kept: ReadonlySet<string>): Set<string> => {
    const back = new Set(kept);
    const add = (name: string): void => { if (back.has(name)) return; back.add(name); for (const p of needs(name)) if (chosen.has(p)) add(p); };
    add(step);
    return back;
  };
  // Move the costliest movable steps until the selection fits -- or costs no
  // more than the steps that never move do alone -- then put back the
  // cheapest moved ones that still fit: a step that runs in the shadow of a
  // longer one costs no wall time.
  const all = new Set(chosen.keys());
  const target = Math.max(input.budget.seconds, cost(fixed).seconds);
  const costliest = steps.filter(s => !fixed.has(s.step)).sort((a, b) => b.cost.cpu - a.cost.cpu || (a.step < b.step ? -1 : 1));
  let kept: Set<string> = new Set(all);
  for (const s of costliest) {
    if (cost(kept).seconds <= target) break;
    if (kept.has(s.step)) kept = without(s.step, kept);
  }
  for (const s of [...costliest].reverse()) {
    if (kept.has(s.step)) continue;
    const back = withStep(s.step, kept);
    if (cost(back).seconds <= target) kept = back;
  }
  const landing = steps.filter(s => kept.has(s.step));
  // An owed step deferred by its form but run as a prerequisite is not deferred.
  const final = deferred.filter(d => !kept.has(d.step));
  for (const m of steps) {
    if (kept.has(m.step) || m.form === "prerequisite") continue; // a prerequisite is owed only through what moved, or deferred above by its own form
    if (m.for) for (const step of m.for) final.push({ step, why: "over the budget", sample: m.step });
    else final.push({ step: m.step, why: "over the budget" });
  }
  // What the rules reach beyond what a landing owes: the wide steps, the full check's.
  for (const step of input.owed.reach ?? []) {
    if (!owed.includes(step) && !kept.has(step) && !final.some(d => d.step === step)) final.push({ step, why: "after landing" });
  }
  const total = estimate(landing, input.budget);
  const alone = estimate(landing.filter(s => fixed.has(s.step)), input.budget).seconds;
  return { owed, landing, deferred: final, estimate: { ...total, fixed: alone }, budget: input.budget, fits: total.seconds <= input.budget.seconds };
}

/** A step's seconds: its CPU over the width it can use (see the header). */
export function stepSeconds(cost: StepCost, row: StepRow | undefined, budget: Budget): number {
  const granted = usableWidth(row ?? {}, budget);
  const observed = cost.wall !== undefined && cost.wall > 0 ? Math.min(cost.cpu / cost.wall, budget.slots) : 0;
  if (cost.cpu === 0) return 0;
  return cost.cpu / (cost.source === "landing" && observed > 0 ? observed : Math.max(granted, observed));
}

function estimate(steps: readonly Landing[], budget: Budget): Omit<Estimate, "fixed"> {
  const build = steps.find(s => s.step === "build")?.seconds ?? 0;
  const rest = steps.filter(s => s.step !== "build");
  const work = rest.reduce((sum, s) => sum + s.cost.cpu, 0) / budget.slots;
  let longest = 0, longestStep: string | null = null;
  for (const s of rest) if (s.seconds > longest) { longest = s.seconds; longestStep = s.step; }
  return { seconds: build + Math.max(work, longest), build, work, longest, longestStep };
}

/** The owed steps a landing left to the full check: every deferred one. */
export function deferredSteps(selection: Pick<Selection, "deferred">): string[] {
  return [...new Set(selection.deferred.map(d => d.step))];
}

/** The steps the landing check runs, as all.sh names them, build first. */
export function landingSteps(selection: Pick<Selection, "landing">): string[] {
  const names = selection.landing.map(s => s.step);
  return names.includes("build") ? ["build", ...names.filter(name => name !== "build")] : names;
}

// ---------------------------------------------------------------------------
// Recorded costs.
//
// The landing check's own measurements come first: they are taken in its own
// profile, on its own warm tree. A build and the steps that compile Rust cost
// very different amounts when a change touches Rust and when it does not, so
// those are kept per kind of change. Then the gate's committed baseline
// (tooling/gate/times.tsv), then the default.
// ---------------------------------------------------------------------------

/** The steps whose cost depends on whether the change recompiles Rust. */
export const COMPILES = new Set(["build", "clippy", "tests", "doctests"]);
export type ChangeKind = "rust" | "other";
type Measured = { cpu: number; wall?: number };
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** The landing check's own record: `{ version: 1, steps: { "<step>" | "<step>:<kind>": { cpu, wall } } }`. */
export function readLandingCosts(file: string): Map<string, Measured> {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown; steps?: Record<string, unknown> };
    if (value.version !== 1 || !value.steps || typeof value.steps !== "object") return new Map();
    const out = new Map<string, Measured>();
    for (const [key, row] of Object.entries(value.steps)) {
      const r = row as { cpu?: unknown; wall?: unknown };
      if (!/^[a-z][a-z0-9-]*(?::(?:rust|other))?$/.test(key) || !positive(r?.cpu)) continue;
      out.set(key, positive(r.wall) ? { cpu: r.cpu, wall: r.wall } : { cpu: r.cpu });
    }
    return out;
  } catch { return new Map(); }
}

/** The key a step's measurement is kept under, for this kind of change. */
export function costKey(step: string, kind: ChangeKind): string {
  return COMPILES.has(step) ? `${step}:${kind}` : step;
}

/** The committed baseline: `step  wall  cpu  slots`, `#` comments. */
export function readBaseline(text: string): Map<string, Measured> {
  const out = new Map<string, Measured>();
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    const [name, wall, cpu] = line.split("\t");
    if (!name || !positive(Number(cpu))) continue;
    out.set(name, positive(Number(wall)) ? { cpu: Number(cpu), wall: Number(wall) } : { cpu: Number(cpu) });
  }
  return out;
}

/** A cost for every step: the landing check's own, else the baseline, else a minute at full width. */
export function costLookup(own: ReadonlyMap<string, Measured>, baseline: ReadonlyMap<string, Measured>, kind: ChangeKind,
  rows: ReadonlyMap<string, StepRow>, budget: Budget): (step: string) => StepCost {
  return step => {
    const mine = own.get(costKey(step, kind)) ?? (COMPILES.has(step) ? undefined : own.get(step));
    if (mine) return { ...mine, measured: true, source: "landing" };
    const base = baseline.get(step);
    if (base) return { ...base, measured: true, source: "baseline" };
    return { cpu: 60 * usableWidth(rows.get(step) ?? {}, budget), measured: false, source: "default" };
  };
}

/**
 * Whether a change recompiles Rust: a path in a crate, in a directory a crate
 * compiles in (`include_str!`), a Rust source, or the toolchain and lock
 * files. Third-party sources count: tsrs is a path dependency, not a member.
 * Only the estimate reads this; what runs is the rules' answer.
 */
export function recompilesRust(paths: readonly string[], inCrate: (path: string) => boolean): boolean {
  return paths.some(path => inCrate(path) || path.endsWith(".rs") || /^(Cargo\.(toml|lock)|rust-toolchain\.toml)$/.test(path) || path.startsWith("third_party/"));
}

/** The machine's budget, as the gate sizes itself: three quarters of the cores (run.mjs). */
export function machineBudget(cores: number, seconds = 600): Budget {
  const slots = Math.max(1, Math.floor(cores * 3 / 4));
  return { slots, frontends: slots, seconds };
}

// ---------------------------------------------------------------------------
// What a dry run prints.
// ---------------------------------------------------------------------------
const minutes = (seconds: number) => seconds >= 60 ? `${(seconds / 60).toFixed(1)} min` : `${Math.round(seconds)} s`;

export function describeSelection(selection: Selection): string {
  const lines: string[] = [];
  const { estimate: e, budget } = selection;
  lines.push(`landing steps (${selection.landing.length}):`);
  // The build, then what never moves, what may, and the tree checks last.
  const rank = (s: Landing) => s.step === "build" ? 0 : ["as-is", "fixtures", "sample", "prerequisite", "tree"].indexOf(s.form) + 1;
  for (const step of [...selection.landing].sort((a, b) => rank(a) - rank(b) || (a.step < b.step ? -1 : 1))) {
    const stands = step.for ? ` for ${step.for.join(" ")}` : "";
    const cost = step.cost.measured ? `cpu ${Math.round(step.cost.cpu)} s (${step.cost.source})` : "not measured: a minute at full width";
    lines.push(`  ${step.step.padEnd(24)} ${step.form.padEnd(8)} ~${minutes(step.seconds).padEnd(8)} ${cost}${stands}`);
  }
  const groups = new Map<Why, Deferred[]>();
  for (const d of selection.deferred) groups.set(d.why, [...(groups.get(d.why) ?? []), d]);
  lines.push(`deferred to the full check (${deferredSteps(selection).length}):`);
  if (!selection.deferred.length) lines.push("  none");
  for (const [why, rows] of groups) lines.push(`  ${why}: ${rows.map(d => d.sample && why !== "after landing" ? `${d.step} (${d.sample})` : d.step).join(" ")}`);
  const parts = [`build ${minutes(e.build)}`, `work ${minutes(e.work)} on ${budget.slots} slots`, `longest ${e.longestStep ?? "none"} ${minutes(e.longest)}`];
  lines.push(`estimate: ${minutes(e.seconds)} of ${minutes(budget.seconds)} (${parts.join(", ")})`);
  if (!selection.fits) lines.push(`  over the budget: the steps that never move take ~${minutes(e.fixed)} on their own`);
  return lines.join("\n");
}
