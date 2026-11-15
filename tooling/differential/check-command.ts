// Execution of compiler check commands; report readers import check-report.ts.
import assert from 'node:assert/strict';
import {statSync} from 'node:fs';
import {activeCommand,CommandNotMeasuredError,COMPILE_CPU_BOUND_SECONDS} from '../gate/active-command.ts';
import {oracleToolchainLocation} from '../gate/host-environment.ts';
import {PressureError,ToolingInstrumentError,CaseBudgetError,instrumentPolicy} from '../gate/step-result.ts';
import {OracleBudgetError} from './oracle-budget.ts';
import {formatFromHelp,checkArguments,decodeCheck,Outcome,checkFailure,completedCompilationRefusal,consumerExit} from './check-report.ts';
import type {CheckFormat,CheckRunOptions,CaseTimeout,DecodedCheck,CheckConsumer,CheckCommandResult} from './check-report-types.ts';
const capabilities=new Map<string,CheckFormat>();
export async function checkFormat(binary: string, options: CheckRunOptions = {}): Promise<CheckFormat> {
  let identity;
  try {
    const stat = statSync(binary, { bigint: true });
    identity = `${binary}\0${stat.ino}\0${stat.size}\0${stat.mtimeNs}`;
  } catch { /* A command found through PATH is probed without caching. */ }
  if (identity !== undefined && capabilities.has(identity)) return capabilities.get(identity)!;
  const result = await checkedCommand(binary, ['--help'], {...options, maxBuffer: 1024 * 1024});
  let format: CheckFormat;
  try { format = formatFromHelp(result.status, result.stdout + result.stderr); }
  catch (error) { throw checkFailure(error, options.env); }
  if (identity !== undefined) capabilities.set(identity, format);
  return format;
}

export async function runCheck(binary: string, project: string, options: CheckRunOptions = {}) {
  const {timeoutOutcome = false, ...runOptions} = options;
  const format = await checkFormat(binary, runOptions);
  // The check compiles in its own process and runs each compiled call in a
  // child under that call's allowance, so its own CPU is the compile's.
  const result = await checkedCommand(binary, checkArguments(format, project, options.oraclePrepared), {...runOptions, maxBuffer: 64 * 1024 * 1024,
    ...(timeoutOutcome ? {ownCpuSeconds: COMPILE_CPU_BOUND_SECONDS} : {})});
  if (result.timeout) return {record: timedOut(format, {stage: 'compile', reason: result.timeout}), result, format, incomplete: undefined};
  try {
    const record = decodeCheck(format, result.status, result.stdout, result.stderr);
    const stops = record.report?.incomplete ?? [];
    if (stops.length) {
      const failures = ['disagrees', 'aborted'].includes(record.report!.status) ? record.report!.disagreements.length + record.report!.aborts.length : 0;
      const chosen = stops.find(stop => stop.kind === 'tooling-setup') ?? stops.find(stop => stop.kind === 'runaway') ?? stops[0]!;
      const policy = instrumentPolicy(chosen.kind, failures);
      assert.ok(policy, 'invalid completed check failures');
      record.first += `; ${stops.map(stop => `${stop.kind}: ${stop.reason}`).join('; ')}`;
      // A completed wrong answer remains an ordinary red result with its
      // structured liveness detail. Only a pure liveness observation holds.
      if (policy.disposition === 'verdict') return {record, result, format, incomplete: undefined};
      // A compiled call past its allowance timed out: the case's outcome.
      if (timeoutOutcome && chosen.kind === 'runaway') {
        return {record: {...record, outcome: Outcome.TIMEOUT, timeout: {stage: 'run' as const, reason: chosen.reason}}, result, format, incomplete: undefined};
      }
      return {record, result, format, incomplete: chosen.kind === 'tooling-setup' ? new ToolingInstrumentError('tooling-setup', chosen.reason) : new CommandNotMeasuredError({...result, [chosen.kind]: chosen.reason})};
    }
    if(record.report?.error?.kind==='oracle_pressure')throw new PressureError(record.report.error.message);
    if(record.budget&&!record.budget.recorded)throw new OracleBudgetError(record.budget.value);
    const incomplete = record.outcome !== Outcome.NOT_MEASURED ? undefined
      : record.timeouts > 0 ? new CommandNotMeasuredError({...result, hung: `check NOT RUN (hung): ${project}; ${record.timeouts} calls did not complete`})
      : new ToolingInstrumentError('tooling-setup', `check not measured: ${project}: ${record.first}`);
    return {record, result, format, incomplete};
  } catch (error) { throw checkFailure(error, options.env); }
}

function timedOut(format: CheckFormat, timeout: CaseTimeout): DecodedCheck {
  return {format, outcome: Outcome.TIMEOUT, status: null, checked: 0, expected: 0, unavailable: 0, declined: 0, timeouts: 0,
    refused: 0, refusedRoots: 0, answers: [], compiledAnswers: [], refusals: [], oracleStopped: 0, missingPopulation: null,
    first: `timed out (${timeout.stage}): ${timeout.reason}`, timeout};
}

export async function runConsumer(binary: string, project: string, consumer: CheckConsumer, options: CheckRunOptions = {}) {
  const observation = await runCheck(binary, project, options);
  try {
    // Refusal-only fixtures ask a completed compilation question, not an
    // oracle question. Their deliberate absence from the oracle corpus can
    // follow valid lowering diagnostics. Process/decoder/liveness failures
    // have already been rejected, and every comparison consumer still holds.
    const compilationRefused = consumer === 'refusal' && completedCompilationRefusal(observation.record);
    if (observation.incomplete && !compilationRefused) throw observation.incomplete;
    return {...observation, incomplete: compilationRefused ? undefined : observation.incomplete,
      exitCode: consumerExit(observation.record, consumer)};
  }
  catch (error) { throw checkFailure(error, options.env); }
}

async function checkedCommand(binary: string, args: string[], options: CheckRunOptions) {
  const {run = activeCommand, cwd = process.cwd(), env = process.env, ...bounds} = options;
  const environment={...env,NTS_ORACLE_TYPESCRIPT:env.NTS_ORACLE_TYPESCRIPT??oracleToolchainLocation()};
  try {
    const result: CheckCommandResult = await run(binary, args, {cwd, env:environment, ...bounds});
    if (result.memoryKilled) {
      const bytes = result.residentLimitBytes;
      if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) {
        throw new ToolingInstrumentError('tooling-setup', `check command was killed by a resident cap without its budget identity: ${binary}`);
      }
      throw new CaseBudgetError(`check command exceeded its ${bytes} byte resident budget: ${binary}`);
    }
    // Stopped at the bound its caller asked for: the caller's outcome.
    if (result.timeout) return result;
    if (result.hung || result.runaway) throw new CommandNotMeasuredError(result);
    if (result.error || result.signal || result.status === null) {
      throw new ToolingInstrumentError('tooling-setup', `check command did not complete: ${binary}: ${result.error?.message ?? result.signal ?? 'missing status'}`);
    }
    if (result.status !== 0 && result.status !== 1) throw new ToolingInstrumentError('tooling-setup', `check command exited outside its result protocol: ${binary}: ${result.status}`);
    return result;
  } catch (error) { throw checkFailure(error, env); }
}
