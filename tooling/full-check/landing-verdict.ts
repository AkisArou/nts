import {GNU_CPU_MEASURE,cpuByMeasure,zeroGnuTime,type GnuTime} from '../gate/step-time.ts';
// Combine the exact commit's landing evidence with its newly measured work.
// The caller supplies the candidate's current contract under its tree lock.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readLandingVerdict } from "../landing/verdict.ts";
import type { VerdictContract } from "../gate/verdict-contract.ts";
import type { RunRecord } from "./state.ts";
import { verdictOf, type Measurement } from "./measure.ts";

type Step = { name: string; verdict: string; reason?: string; accepted?: boolean; cpu?: number;cpu_measure?:string;gnu_time?:GnuTime;wall?: number; log?: string; origin?: Record<string, unknown> };
type Summary = {
  schema?: number; environment?: Record<string, unknown>; identities?: Record<string, unknown>;
  steps?: Step[]; wall_s?: number; [key: string]: unknown;
};

function summaryOf(run: string): Summary {
  try { return JSON.parse(readFileSync(join(run, "summary.json"), "utf8")); }
  catch { return {}; }
}

function totalCpu(steps: readonly Step[]): number | null {
  let total = 0;
  for (const step of steps) {
    if (typeof step.cpu === "number" && Number.isFinite(step.cpu) && step.cpu >= 0) total += step.cpu;
    else if (step.verdict !== "SKIPPED") return null;
  }
  return total;
}

function preparationCpu(run: string): number | null {
  try {
    const [wall, user, system] = readFileSync(join(run, "prepare.cpu"), "utf8").trim().split("\n").at(-1)!.split(" ").map(Number);
    return [wall, user, system].every(value => Number.isFinite(value) && value! >= 0) ? user! + system! : null;
  } catch { return null; }
}

export function measureWithLanding(options: {
  home: string; commit: string; tree: string; contract: VerdictContract; requested: readonly string[];
  evidenceRun: string; lastGreen?: RunRecord; log: (line: string) => void;
  measure: (steps: readonly string[], lastGreen?: RunRecord) => Measurement;
}): Measurement {
  const plan = readLandingVerdict(options.home, options.commit, options.tree, options.contract, options.requested);
  if (!plan.receipt) {
    options.log("core landing reuse: " + plan.reason);
    return options.measure(options.requested, options.lastGreen);
  }
  // Outcome receipts transfer evidence. The core's build obligation also
  // supplies current release artifacts for its consumers and the records pin.
  if (options.requested.includes("build")) {
    plan.reused = plan.reused.filter(step => step.outcome.name !== "build");
    plan.execute = options.requested.filter(name => !plan.reused.some(step => step.outcome.name === name));
  }
  options.log(`core landing reuse: ${plan.reused.length} checked step(s) from ${plan.receipt.landing}; executing ${plan.execute.join(" ") || "none"}`);
  if (!plan.reused.length) return options.measure(options.requested, options.lastGreen);
  const fresh = plan.execute.length ? options.measure(plan.execute, options.lastGreen) : undefined;
  const run = fresh?.run ?? options.evidenceRun;
  mkdirSync(run, { recursive: true });
  const summary: Summary = fresh ? summaryOf(run) : { wall_s: 0 };
  const steps: Measurement["steps"] = { ...fresh?.steps };
  const reasons: Measurement["reasons"] = { ...fresh?.reasons };
  const rows = new Map((summary.steps ?? []).map(step => [step.name, step]));
  for (const reused of plan.reused) {
    const name = reused.outcome.name, log = join(run, name + ".log");
    writeFileSync(log, [...reused.notices, ...reused.platforms.map(platform => platform.line)].join("\n") + "\n");
    steps[name] = "PASS";
    rows.set(name, { ...reused.outcome,cpu_measure:reused.outcome.cpu_measure??GNU_CPU_MEASURE,gnu_time:zeroGnuTime(),cpu: 0, wall: 0, log,
      origin: { kind: "landing", commit: plan.receipt.commit, landing: plan.receipt.landing, run: plan.receipt.run,
        profile: plan.receipt.profile, contract: plan.receipt.contract.identity, cpu: reused.outcome.cpu,cpu_measure:reused.outcome.cpu_measure??GNU_CPU_MEASURE,gnu_time:reused.outcome.gnu_time,wall: reused.outcome.wall } });
  }
  for (const name of plan.execute) {
    if (!steps[name]) { steps[name] = "HELD"; reasons[name] = "fresh measurement omitted the requested step"; }
    if (!rows.has(name)) rows.set(name, { name, verdict: steps[name] === "HELD" ? "NOT RUN" : steps[name], reason: reasons[name] });
  }
  const verdict = verdictOf(steps);
  const preparation = fresh ? preparationCpu(run) : 0;
  const measuredCpu = totalCpu([...rows.values()]);
  const measuredBy=cpuByMeasure([...rows.values()]);
  if(measuredBy&&preparation!==null)measuredBy[GNU_CPU_MEASURE]=(measuredBy[GNU_CPU_MEASURE]??0)+preparation;
  const creditedBy=cpuByMeasure(plan.reused.map(step=>step.outcome));
  const basis=(totals:Record<string,number>|null)=>totals===null?null:Object.keys(totals).filter(key=>totals[key]!>0).sort().join('+')||GNU_CPU_MEASURE;
  const execution = {
    steps: plan.execute,
    preparation_cpu_s: preparation,
    preparation_cpu_measure:GNU_CPU_MEASURE,
    cpu_measure:basis(measuredBy),cpu_s_by_measure:measuredBy,
    credited_cpu_measure:basis(creditedBy),credited_cpu_s_by_measure:creditedBy,
    gnu_cpu_s:preparation===null?null:[...rows.values()].reduce((sum,row)=>{
      if(row.cpu===undefined&&row.verdict==='SKIPPED')return sum;
      const legacy=row.gnu_time?.cpu??((row.cpu_measure??GNU_CPU_MEASURE)===GNU_CPU_MEASURE?row.cpu:undefined);
      return sum+(legacy??NaN);
    },preparation),
    cpu_s: preparation === null || measuredCpu === null ? null : preparation + measuredCpu,
    credited_cpu_s: totalCpu(plan.reused.map(step => step.outcome)),
    receipt: plan.receipt.landing,
    contract: options.contract.identity,
  };
  const combined = {
    ...summary, schema: 1,
    identities: { ...summary.identities, commit: options.commit },
    environment: { ...summary.environment, canonical: fresh ? summary.environment?.canonical === true : true, contract: options.contract },
    verdict, requested: [...options.requested], executed: plan.execute, execution,
    steps: options.requested.map(name => rows.get(name)),
  };
  writeFileSync(join(run, "summary.json"), JSON.stringify(combined, null, 2) + "\n");
  writeFileSync(join(run, "landing-verdict.json"), JSON.stringify(plan.receipt, null, 2) + "\n");
  return { commit: options.commit, run, steps, reasons, verdict, reused: plan.reused.map(step => step.outcome.name) };
}
