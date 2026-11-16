// A failed instrument is evidence to wait, never evidence against a landing.
import { readFileSync } from "node:fs";
import {ToolingInstrumentError,publishToolingFailure,publishInstrumentResult,readDiskBuildRefusal,type InstrumentResult} from '../differential/command-entry/instrument.ts';
export {ToolingInstrumentError,DiskBuildAdmissionError,readDiskBuildRefusal,publishToolingFailure,type DiskBuildRefusal,type InstrumentResult} from '../differential/command-entry/instrument.ts';
export type {StepDiagnostics,DiagnosticsSummary} from './run-diagnostics.ts';
type Disposition={verdict:InstrumentResult["verdict"];disposition:"retry"|"operator-hold"|"verdict"};
export const INSTRUMENT_DISPOSITIONS={
  "memory-pressure":{verdict:"INSTRUMENT",disposition:"retry"},
  // The run releases its memory; the service retries only after disk admits.
  "disk-capacity":{verdict:"INSTRUMENT",disposition:"operator-hold"},
  "hung":{verdict:"NOT RUN",disposition:"operator-hold"},
  "runaway":{verdict:"NOT RUN",disposition:"operator-hold"},
  "tooling-setup":{verdict:"INSTRUMENT",disposition:"operator-hold"},
  "tooling-cleanup":{verdict:"INSTRUMENT",disposition:"operator-hold"},
  // The runner stopped a step at its bound (step-bound.ts): it never finished.
  "step-bound":{verdict:"INSTRUMENT",disposition:"operator-hold"},
  "selector-setup":{verdict:"INSTRUMENT",disposition:"operator-hold"},
  "case-budget":{verdict:"FAIL",disposition:"verdict"},
} as const satisfies Record<InstrumentResult["kind"],Disposition>;
export function instrumentPolicy(kind:unknown,completedFailures:unknown=0):Disposition|undefined {
  if(typeof completedFailures!=="number"||!Number.isSafeInteger(completedFailures)||completedFailures<0)return;
  if(typeof kind!=="string"||!Object.hasOwn(INSTRUMENT_DISPOSITIONS,kind))return;
  // A liveness observation cannot erase a test that already finished failing.
  // The count comes from completed results, never an exit code or log text.
  if(completedFailures>0&&(kind==="hung"||kind==="runaway"))return {verdict:"FAIL",disposition:"verdict"};
  return INSTRUMENT_DISPOSITIONS[kind as InstrumentResult["kind"]];
}
function publish(kind:InstrumentResult["kind"],reason:string,env:NodeJS.ProcessEnv,completedFailures=0):void {
  const policy=instrumentPolicy(kind,completedFailures);
  if(!policy)throw new Error("invalid completed-failure evidence");
  const path=env.NTS_GATE_STEP_RESULT,step=env.NTS_GATE_STEP,attempt=env.NTS_GATE_STEP_ATTEMPT;
  if(!path||!step||!attempt)return;
  const result:InstrumentResult={version:1,verdict:policy.verdict,kind,step,attempt,reason,...(completedFailures?{completedFailures}:{})};
  publishInstrumentResult(result,env);
}
export function publishHung(reason:string,env:NodeJS.ProcessEnv=process.env,completedFailures=0):void {
  publish("hung",reason,env,completedFailures);
}
export function publishRunaway(reason:string,env:NodeJS.ProcessEnv=process.env,completedFailures=0):void {
  publish("runaway",reason,env,completedFailures);
}
export function publishSelectorFailure(error:unknown,env:NodeJS.ProcessEnv=process.env):void {
  if(error instanceof Error&&"code" in error&&error.code==="NTS_SELECTION_INFRASTRUCTURE")publish("selector-setup",error.message,env);
}
export class PressureError extends Error {
  constructor(reason: string) { super(reason); this.name = "PressureError"; }
}
export class CaseBudgetError extends Error {
  constructor(reason: string) { super(reason); this.name = "CaseBudgetError"; }
}
export function publishPressure(error: unknown, env: NodeJS.ProcessEnv = process.env): void {
  if (!(error instanceof PressureError || error instanceof CaseBudgetError) || env.NTS_CENSUS_POOL_WORKER === "1") return;
  publish(error instanceof PressureError ? "memory-pressure" : "case-budget",error.message,env);
}
export function readStepInstrument(path: string, step: string, attempt: string): InstrumentResult | undefined {
  let result;
  try { result = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return; throw error; }
  const policy=instrumentPolicy(result.kind,result.completedFailures);
  if (result.version !== 1 || !policy || policy.verdict!==result.verdict
      || result.step !== step || result.attempt !== attempt || typeof result.reason !== "string" || !result.reason) {
    throw new Error(`invalid instrument result for ${step}`);
  }
  if(result.kind==='disk-capacity')readDiskBuildRefusal(result.disk);
  else if(result.disk!==undefined)throw new Error(`unexpected disk refusal for ${step}`);
  return result;
}
// Monitors do not consume the exception: the command still fails. Intermediate
// pool workers cannot publish, since their parent may recover by replaying.
process.on("uncaughtExceptionMonitor", error => {
  if(error instanceof ToolingInstrumentError)publishToolingFailure(error);
  else {publishSelectorFailure(error);publishPressure(error);}
});
