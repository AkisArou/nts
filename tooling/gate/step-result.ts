// A failed instrument is evidence to wait, never evidence against a landing.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
export type InstrumentResult = { version: 1; verdict: "INSTRUMENT" | "FAIL" | "NOT RUN"; kind: "memory-pressure" | "case-budget" | "hung" | "runaway" | "tooling-setup" | "tooling-cleanup" | "selector-setup"; step: string; attempt: string; reason: string };
type Disposition={verdict:InstrumentResult["verdict"];disposition:"retry"|"operator-hold"|"verdict"};
export const INSTRUMENT_DISPOSITIONS={
  "memory-pressure":{verdict:"INSTRUMENT",disposition:"retry"},
  "hung":{verdict:"NOT RUN",disposition:"operator-hold"},
  "runaway":{verdict:"NOT RUN",disposition:"operator-hold"},
  "tooling-setup":{verdict:"INSTRUMENT",disposition:"operator-hold"},
  "tooling-cleanup":{verdict:"INSTRUMENT",disposition:"operator-hold"},
  "selector-setup":{verdict:"INSTRUMENT",disposition:"operator-hold"},
  "case-budget":{verdict:"FAIL",disposition:"verdict"},
} as const satisfies Record<InstrumentResult["kind"],Disposition>;
export function instrumentPolicy(kind:unknown):Disposition|undefined {
  return typeof kind==="string"&&Object.hasOwn(INSTRUMENT_DISPOSITIONS,kind)
    ? INSTRUMENT_DISPOSITIONS[kind as InstrumentResult["kind"]] : undefined;
}
export class ToolingInstrumentError extends Error {
  readonly kind: "tooling-setup" | "tooling-cleanup";
  constructor(kind: ToolingInstrumentError["kind"], reason: string, options?: ErrorOptions) { super(reason, options); this.kind=kind; this.name="ToolingInstrumentError"; }
}
function publish(verdict:InstrumentResult["verdict"],kind:InstrumentResult["kind"],reason:string,env:NodeJS.ProcessEnv):void {
  const path=env.NTS_GATE_STEP_RESULT,step=env.NTS_GATE_STEP,attempt=env.NTS_GATE_STEP_ATTEMPT;
  if(!path||!step||!attempt)return;
  const result:InstrumentResult={version:1,verdict,kind,step,attempt,reason};
  const temporary=`${path}.${process.pid}`;writeFileSync(temporary,JSON.stringify(result)+"\n");renameSync(temporary,path);
}
export function publishHung(reason:string,env:NodeJS.ProcessEnv=process.env):void {
  publish("NOT RUN","hung",reason,env);
}
export function publishRunaway(reason:string,env:NodeJS.ProcessEnv=process.env):void {
  publish("NOT RUN","runaway",reason,env);
}
export function publishToolingFailure(error:ToolingInstrumentError,env:NodeJS.ProcessEnv=process.env):void {
  publish("INSTRUMENT",error.kind,error.message,env);
}
export function publishSelectorFailure(error:unknown,env:NodeJS.ProcessEnv=process.env):void {
  if(error instanceof Error&&"code" in error&&error.code==="NTS_SELECTION_INFRASTRUCTURE")publish("INSTRUMENT","selector-setup",error.message,env);
}
export class PressureError extends Error {
  constructor(reason: string) { super(reason); this.name = "PressureError"; }
}
export class CaseBudgetError extends Error {
  constructor(reason: string) { super(reason); this.name = "CaseBudgetError"; }
}
export function publishPressure(error: unknown, env: NodeJS.ProcessEnv = process.env): void {
  if (!(error instanceof PressureError || error instanceof CaseBudgetError) || env.NTS_CENSUS_POOL_WORKER === "1") return;
  publish(error instanceof PressureError ? "INSTRUMENT" : "FAIL",error instanceof PressureError ? "memory-pressure" : "case-budget",error.message,env);
}
export function readStepInstrument(path: string, step: string, attempt: string): InstrumentResult | undefined {
  let result;
  try { result = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  const policy=instrumentPolicy(result.kind);
  if (result.version !== 1 || !policy || policy.verdict!==result.verdict
      || result.step !== step || result.attempt !== attempt || typeof result.reason !== "string" || !result.reason) {
    throw new Error(`invalid instrument result for ${step}`);
  }
  return result;
}
// Monitors do not consume the exception: the command still fails. Intermediate
// pool workers cannot publish, since their parent may recover by replaying.
process.on("uncaughtExceptionMonitor", error => {
  if(error instanceof ToolingInstrumentError)publishToolingFailure(error);
  else {publishSelectorFailure(error);publishPressure(error);}
});
