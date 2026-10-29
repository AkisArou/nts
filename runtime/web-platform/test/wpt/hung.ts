// Liveness is an instrument observation, never a WPT verdict.
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { publishHung, type InstrumentResult } from "../../../../tooling/gate/step-result.ts";
import type { WptActivity, WptDeadlineScheduler, WptResult } from "./harness.ts";

export const wptHostDeadline: WptDeadlineScheduler = (callback, milliseconds) => {
  const timer = setTimeout(callback, milliseconds);
  return () => clearTimeout(timer);
};

/** Both WPT runners use one renewable, generously bounded file instrument. */
export class WptInactivityGuard {
  private cancel: (() => void) | undefined;
  private generation = 0;
  private closed = false;
  private readonly expired: (activity: WptActivity, result?: WptResult) => void;
  private readonly schedule: WptDeadlineScheduler;
  private readonly milliseconds: number;
  constructor(
    expired: (activity: WptActivity, result?: WptResult) => void,
    schedule: WptDeadlineScheduler = wptHostDeadline,
    milliseconds = 300000,
  ) {
    if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) throw new Error("invalid WPT inactivity bound");
    this.expired = expired;
    this.schedule = schedule;
    this.milliseconds = milliseconds;
  }
  renew(activity: WptActivity, result?: WptResult): void {
    if (this.closed) return;
    this.cancel?.();
    const generation = ++this.generation;
    this.cancel = this.schedule(() => {
      if (this.closed || generation !== this.generation) return;
      this.close();
      this.expired(activity, result);
    }, this.milliseconds, activity);
  }
  close(): void { this.closed = true; this.generation++; this.cancel?.(); }
}

export class WptHungError extends Error {
  readonly observation: InstrumentResult;
  readonly testResult: WptResult | undefined;
  constructor(file: string, test: string, phase: string, testResult?: WptResult) {
    const reason = `${file}: ${test}: ${phase} made no progress before the liveness bound`;
    super(reason);
    this.name = "WptHungError";
    this.observation = {
      version: 1, verdict: "NOT RUN", kind: "hung", reason,
      step: process.env.NTS_GATE_STEP ?? "web-platform",
      attempt: process.env.NTS_GATE_STEP_ATTEMPT ?? "standalone",
    };
    // A completed body and its unfinished cleanup are separate observations.
    this.testResult = testResult === undefined ? undefined : { ...testResult };
  }
}

function errorDetail(error: unknown): { message: string; stack?: string } {
  let message: string;
  try { message = String(error); } catch { message = "<unprintable thrown value>"; }
  let stack: string | undefined;
  try {
    if (typeof error === "object" && error !== null && "stack" in error && typeof error.stack === "string") stack = error.stack;
  } catch { /* A diagnostic getter cannot turn a hung instrument into a failure. */ }
  return { message, ...(stack === undefined ? {} : { stack }) };
}

/** Only the execution boundary publishes: deliberate controls stay local. */
export function reportWptHung(error: WptHungError, env: NodeJS.ProcessEnv = process.env,
  write: (text: string) => void = text => { process.stderr.write(text); }): void {
  publishHung(error.observation.reason, env);
  const body = error.testResult;
  const testResult = body === undefined ? undefined : { ...body,
    ...(Object.hasOwn(body, "error") ? { error: errorDetail(body.error) } : {}) };
  const record = JSON.stringify({ ...error.observation, testResult });
  if (env.NTS_WPT_HUNG_RESULTS) appendFileSync(env.NTS_WPT_HUNG_RESULTS, record + "\n");
  write(`NOT RUN (hung): ${record}\n`);
}

export function readWptHungResults(path: string): InstrumentResult[] {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  return lines.map(line => {
    const value: unknown = JSON.parse(line);
    if (typeof value !== "object" || value === null || !("version" in value) || value.version !== 1 ||
      !("verdict" in value) || value.verdict !== "NOT RUN" || !("kind" in value) || value.kind !== "hung" ||
      !("reason" in value) || typeof value.reason !== "string" || !value.reason ||
      !("step" in value) || typeof value.step !== "string" || !value.step ||
      !("attempt" in value) || typeof value.attempt !== "string" || !value.attempt)
      throw new Error("invalid WPT hung observation");
    return value as InstrumentResult;
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv[2] === "--outer") {
    reportWptHung(new WptHungError("<host suite>", "<unfinished file>", "outer execution"));
    process.exitCode = 124;
  } else {
    const results = readWptHungResults(process.argv[2]!);
    for (const result of results) publishHung(result.reason);
    if (results.length) process.exitCode = 124;
  }
}
