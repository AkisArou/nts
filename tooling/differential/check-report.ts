// Versioned check decoding is shared by every machine consumer.
import assert from 'node:assert/strict';
import {statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

import { CHECK_STATUSES, FAILURE_KINDS, COUNT_NAMES } from "./check-report-types.ts";
import type { CheckCommandResult, CheckConsumer, CheckCounts, CheckFormat, CheckObservation, CheckRefusal, CheckReport,
  CheckRunOptions, DecodedCheck, LegacyIdentity } from "./check-report-types.ts";
import { normalizeGeneratedNumbers, stableCheckText, stableRuntimeAbortOutput } from "../conformance/observation-text.ts";
import {activeCommand, CommandNotMeasuredError} from "../gate/active-command.ts";
import {CaseBudgetError, PressureError, ToolingInstrumentError, instrumentPolicy,
  publishHung, publishRunaway, publishToolingFailure, publishPressure, readStepInstrument} from "../gate/step-result.ts";

const SUCCESS = new Set<string>(['nothing', 'agrees', 'partial', 'all_unavailable']);
const capabilities = new Map<string, CheckFormat>();

function object(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), label);
  return Object.fromEntries(Object.entries(value));
}
function exactKeys(value: Record<string, unknown>, names: readonly string[], label: string): void {
  assert.deepEqual(Object.keys(value).sort(), [...names].sort(), label);
}
function integer(value: unknown, label: string): number {
  assert.ok(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, label);
  return value;
}
function text(value: unknown, label: string): string {
  assert.equal(typeof value, 'string', label);
  assert.ok(typeof value === 'string');
  return value;
}
function array(value: unknown, label: string): unknown[] {
  assert.ok(Array.isArray(value), label);
  return value;
}
function member<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  for (const choice of choices) if (value === choice) return choice;
  throw new Error(label);
}

/** Only the compiler's advertised interface selects the legacy decoder. */
export function formatFromHelp(status: number | null, output: string): CheckFormat {
  assert.equal(status, 0, 'cannot determine the compiler check-report capability');
  assert.match(output, /^\s*check\s+.*compile.*compare/m, 'missing check capability description');
  return /^\s*check\s+[^\n]*--json\b/m.test(output) ? 'json-v1' : 'legacy';
}

/** Cache by artifact identity, so replacing a test double cannot retain its capability. */
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

/** Build the command after capability selection; JSON failures never trigger a retry. */
export function checkArguments(format: CheckFormat, project: string): string[] {
  assert.ok(format === 'json-v1' || format === 'legacy', 'unknown check interface');
  return ['check', project, ...(format === 'json-v1' ? ['--json'] : [])];
}

/** Liveness observations shared by check reports and corpus verification rows. */
export function parseCheckStops(value: unknown) {
  return array(value, 'invalid supervisor observations').map(raw => {
    const event = object(raw, 'invalid supervisor observation');
    exactKeys(event, ['kind', 'reason', 'case_index'], 'supervisor observation fields');
    const reason = text(event.reason, 'invalid supervisor reason'); assert.ok(reason.length > 0, 'empty supervisor reason');
    return {kind: member(event.kind, ['hung', 'runaway', 'tooling-setup'] as const, 'unknown supervisor stop'), reason,
      case_index: event.case_index === null ? null : integer(event.case_index, 'invalid supervisor case index')};
  });
}

/** Validate the full versioned shape and the independently derivable disposition. */
export function parseJsonReport(input: string, exitStatus: number | null): CheckReport {
  const value = object(JSON.parse(input), 'check JSON must be an object');
  assert.ok(value.version === 1 || value.version === 2, 'unsupported check report version');
  const version = value.version;
  exactKeys(value, ['version', 'status', 'counts', 'oracle', 'refusals', 'disagreements', 'aborts', 'error', ...(version === 2 ? ['incomplete'] : [])], 'check report fields');
  const incomplete = version === 2 ? parseCheckStops(value.incomplete) : [];
  const status = member(value.status, CHECK_STATUSES, 'unknown check status');
  const refusals = array(value.refusals, 'check refusals must be an array').map(raw => {
    const refusal = object(raw, 'invalid check refusal');
    exactKeys(refusal, ['stage', 'code', 'message'], 'check refusal fields');
    return { stage: member(refusal.stage, ['lowering', 'backend', 'typecheck'] as const, 'unknown refusal stage'),
      code: text(refusal.code, 'invalid check refusal text'), message: text(refusal.message, 'invalid check refusal text') };
  });
  const disagreements = array(value.disagreements, 'invalid check findings').map(raw => {
    const answer = object(raw, 'invalid disagreement');
    exactKeys(answer, ['compiled', 'node'], 'disagreement fields');
    return { compiled: text(answer.compiled, 'invalid disagreement text'), node: text(answer.node, 'invalid disagreement text') };
  });
  const aborts = array(value.aborts, 'invalid check findings').map(raw => text(raw, 'invalid abort reason'));
  assert.ok(Number.isInteger(exitStatus), 'check process did not finish normally');
  assert.equal(exitStatus === 0, SUCCESS.has(status), 'check exit status contradicts its structured disposition');
  if (status === 'error') {
    assert.equal(value.counts, null, 'failed check cannot claim measured counts');
    assert.equal(value.oracle, null, 'failed check cannot claim oracle completion');
    assert.equal(disagreements.length, 0, 'a stage error cannot carry comparison findings');
    assert.equal(aborts.length, 0, 'a stage error cannot carry runtime findings');
    assert.equal(incomplete.length, 0, 'a stage error cannot carry measured liveness findings');
    const error = object(value.error, 'missing structured check error');
    exactKeys(error, ['kind', 'source', 'message'], 'check error fields');
    return { version, ...(version === 2 ? {incomplete} : {}), status, counts: null, oracle: null, refusals, disagreements, aborts, error: {
      kind: member(error.kind, FAILURE_KINDS, 'unknown check failure kind'),
      source: error.source === null ? null : text(error.source, 'invalid check source identity'),
      message: text(error.message, 'missing check error message'),
    } };
  }
  assert.equal(value.error, null, 'measured check cannot carry a stage error');
  const rawCounts = object(value.counts, 'missing check counts');
  exactKeys(rawCounts, COUNT_NAMES, 'check count fields');
  const counts: CheckCounts = {
    functions: integer(rawCounts.functions, 'invalid check count: functions'),
    expected: integer(rawCounts.expected, 'invalid check count: expected'),
    compared: integer(rawCounts.compared, 'invalid check count: compared'),
    unavailable: integer(rawCounts.unavailable, 'invalid check count: unavailable'),
    runtime_declined: integer(rawCounts.runtime_declined, 'invalid check count: runtime_declined'),
    timeouts: integer(rawCounts.timeouts, 'invalid check count: timeouts'),
    approximated: integer(rawCounts.approximated, 'invalid check count: approximated'),
    disagreements: integer(rawCounts.disagreements, 'invalid check count: disagreements'),
    aborts: integer(rawCounts.aborts, 'invalid check count: aborts'),
  };
  assert.equal(counts.disagreements, disagreements.length, 'disagreement count changed');
  assert.equal(counts.aborts, aborts.length, 'abort count changed');
  assert.ok(counts.compared + counts.unavailable + counts.runtime_declined + counts.timeouts <= counts.expected,
    'check populations overlap or exceed the source plan');
  assert.ok(counts.approximated <= counts.compared, 'approximation count exceeds comparisons');
  const rawOracle = object(value.oracle, 'missing check oracle population');
  exactKeys(rawOracle, ['expected', 'received', 'complete'], 'oracle count fields');
  const expected = integer(rawOracle.expected, 'invalid oracle expected count');
  const received = integer(rawOracle.received, 'invalid oracle received count');
  const complete = received === expected;
  assert.equal(expected, counts.expected, 'oracle and source populations differ');
  assert.equal(rawOracle.complete, complete, 'oracle completion contradicts its counts');
  const derived = counts.functions === 0 ? 'nothing'
    : !complete ? 'not_measured'
    : counts.disagreements > 0 ? 'disagrees'
    : counts.aborts > 0 ? 'aborted'
    : incomplete.length > 0 || counts.timeouts > 0 || counts.compared + counts.unavailable + counts.runtime_declined !== counts.expected ? 'not_measured'
    : counts.unavailable === counts.expected && counts.expected > 0 ? 'all_unavailable'
    : counts.compared === 0 ? (counts.runtime_declined === counts.expected && counts.expected > 0 ? 'all_declined' : 'not_measured')
    : counts.compared === counts.expected ? 'agrees' : 'partial';
  if (counts.functions === 0) assert.equal(counts.expected, 0, 'an empty export inventory has cases');
  if (counts.functions > 0) assert.ok(counts.expected > 0, 'a declared export has an empty population');
  assert.equal(status, derived, 'check disposition contradicts its structured fields');
  return { version, ...(version === 2 ? {incomplete} : {}), status, counts, oracle: { expected, received, complete }, refusals, disagreements, aborts, error: null };
}

/** A common record for agreement, gate and outcome consumers. */
export function decodeCheck(format: unknown, status: number | null, stdout: string, stderr = ''): DecodedCheck {
  if (format === 'legacy') return { ...legacyCheck(status, stdout + stderr), format };
  assert.equal(format, 'json-v1', 'a check decoder format must be selected explicitly');
  const report = parseJsonReport(stdout, status);
  const counts = report.counts;
  const error = report.error;
  const byStatus = {
    nothing: Outcome.NOTHING, agrees: Outcome.AGREES, partial: Outcome.PARTIAL,
    all_unavailable: Outcome.UNAVAILABLE, all_declined: Outcome.ALL_DECLINED,
    disagrees: Outcome.DISAGREES, aborted: Outcome.ABORTED, not_measured: Outcome.NOT_MEASURED,
  };
  const unresolved = error?.kind === 'typecheck' && report.refusals.some(one => ['TS2307', 'TS6059'].includes(one.code));
  const outcome = report.status !== 'error' ? byStatus[report.status]
    : error?.kind === 'typecheck' && !unresolved ? Outcome.NO_TYPECHECK
    : error?.kind === 'preparation' ? Outcome.INVALID_HIR
    : error?.kind === 'backend_declined' ? Outcome.BACKEND_DECLINED
    : error?.kind === 'emitter' ? Outcome.ABORTED : Outcome.NOT_MEASURED;
  return {
    format, outcome, status, checked: counts?.compared ?? 0, expected: counts?.expected ?? 0,
    unavailable: counts?.unavailable ?? 0,
    declined: (counts?.unavailable ?? 0) + (counts?.runtime_declined ?? 0),
    timeouts: counts?.timeouts ?? 0,
    refused: report.refusals.filter(one => one.stage === 'lowering').length,
    refusedRoots: report.refusals.filter(one => one.stage === 'lowering' && !['NTS1003', 'NTS1005'].includes(one.code)).length,
    answers: [
      ...report.disagreements.flatMap(one => [`  nts  ${one.compiled}`, `  node ${one.node}`]),
      ...report.aborts.map(reason => `  the compiled program aborted: ${reason}`),
    ],
    compiledAnswers: report.disagreements.map(one => one.compiled),
    refusals: report.refusals,
    oracleStopped: error?.kind === 'oracle_execution' ? 1 : 0,
    missingPopulation: error?.kind === 'oracle_coverage' ? error.source : null,
    first: unresolved ? 'needs an installed workspace; cannot resolve here' : error?.message ?? outcome,
    report,
  };
}

function completedCompilationRefusal(record: DecodedCheck): boolean {
  return record.report?.error?.kind === 'oracle_coverage' &&
    record.refusals.some(one => one.stage === 'lowering');
}

/** Consumer dispositions: 0 compared/refused as requested, 2 empty, 3 unavailable, 1 bad. */
export function consumerExit(record: DecodedCheck, consumer: CheckConsumer): number {
  assert.ok(['program', 'benchmark', 'refusal'].includes(consumer), 'unknown check consumer');
  if (consumer === 'refusal' && completedCompilationRefusal(record)) return 0;
  if (record.outcome === Outcome.NOT_MEASURED) throw new ToolingInstrumentError('tooling-setup', `check not measured: ${record.first}`);
  if (consumer === 'refusal') {
    return record.refused > 0 || record.outcome === Outcome.NO_TYPECHECK ||
      record.outcome === Outcome.BACKEND_DECLINED ? 0 : 1;
  }
  if (record.outcome === Outcome.AGREES || record.outcome === Outcome.PARTIAL) return record.checked > 0 ? 0 : 1;
  if (record.outcome === Outcome.NOTHING) return 2;
  if (record.outcome === Outcome.UNAVAILABLE) return 3;
  return 1;
}

/** Outcome fixtures retain typed observations; their display text is never a verdict. */
export function checkOutcome(format: CheckFormat, status: number | null, stdout: string, stderr = ''): CheckObservation {
  if (format === 'legacy') {
    // Only an explicitly selected old capability reaches the text decoder.
    const decoded = decodeCheck(format, status, stdout, stderr);
    const observation = legacyOutcome((stdout + stderr).split('\n').map(line => line.trim()), status);
    if (observation.category === 'agrees' && decoded.outcome !== Outcome.AGREES && decoded.outcome !== Outcome.PARTIAL) {
      return {category: 'not-measured', nts: 'the legacy check compared no complete population'};
    }
    return { ...observation, nts: outcomeText(observation.category, observation.nts) };
  }
  const {report} = decodeCheck(format, status, stdout, stderr);
  assert.ok(report);
  const check = stableReport(report);
  const {counts, error} = check;
  if (error) {
    const category = error.kind === 'preparation' ? 'invalid-hir'
      : error.kind === 'backend_declined' ? 'refused'
      : error.kind === 'emitter' ? 'aborted' : 'not-measured';
    return { category, nts: error.message, check };
  }
  assert.ok(counts && check.oracle);
  let category: CheckObservation["category"];
  if (!check.oracle.complete) category = 'not-measured';
  else if (counts.disagreements > 0) category = 'wrong-answer';
  else if (counts.aborts > 0) category = 'aborted';
  else if (counts.timeouts > 0 || check.incomplete?.length) category = 'not-measured';
  else if (counts.runtime_declined > 0) category = 'aborted';
  else if (counts.unavailable > 0 || (check.status === 'nothing' && check.refusals.length > 0)) category = 'refused';
  else if (check.status === 'agrees') category = 'agrees';
  else category = 'not-measured';
  const nts = category === 'refused'
    ? check.refusals.map(one => `${one.code} ${one.message}`).join(' | ') || 'compiled binding unavailable'
    : check.aborts[0] ?? (category === 'aborted' ? `${counts.runtime_declined} runtime declines`
      : `${check.status}: ${counts.compared} compared, ${counts.expected} expected, ${counts.disagreements} disagreements`);

  return {category, nts, check};
}

function stableReport(report: CheckReport): CheckReport {
  const stable = (text: string) => stableCheckText(text).replace(/uniform slot \d+/g, 'uniform slot N');
  // V2 adds liveness observations. A completed observation still has exactly
  // the V1 record identity; changing transport alone never rewrites evidence.
  const {incomplete, ...v1} = report;
  const compatible = incomplete?.length ? report : {...v1, version: 1 as const};
  return {
    ...compatible,
    refusals: report.refusals.map(one => ({...one, message: normalizeGeneratedNumbers(stable(one.message))})),
    aborts: report.aborts.map(stableRuntimeAbortOutput),
    error: report.error === null ? null : {...report.error, message:
      ['preparation', 'backend_declined'].includes(report.error.kind)
        ? normalizeGeneratedNumbers(stable(report.error.message)) : stable(report.error.message)},
  };
}

function outcomeText(category: string, text: string): string {
  const located = stableCheckText(text);
  if (category === 'invalid-hir' || category === 'refused') return normalizeGeneratedNumbers(located);
  return category === 'aborted' ? stableRuntimeAbortOutput(located) : located;
}

function storedCheckOutcome(previous: unknown) {
  const was = object(previous, 'stored check outcome must be an object');
  const version = was.version ?? 0;
  assert.ok(version === 0 || version === 1, 'unknown stored outcome version');
  if (version === 1) {
    assert.ok(was.check, 'a structured check record requires a structured observation');
    const candidate = object(was.check, 'stored check report');
    const exit = typeof candidate.status === 'string' && SUCCESS.has(candidate.status) ? 0 : 1;
    return {version: 1 as const, check: stableReport(parseJsonReport(JSON.stringify(candidate), exit))};
  }
  const recorded = {category: text(was.category, 'stored outcome category'), nts: text(was.nts, 'stored outcome text')};
  return {version: 0 as const, ...recorded, identity: legacyIdentity(recorded)};
}

/** Validate historical metadata before any compiler work is admitted. */
export function validateStoredCheckOutcome(previous: unknown): void { storedCheckOutcome(previous); }

/** Record version, never a failed modern parse, selects stored-text compatibility. */
export function sameCheckOutcome(previous: unknown, now: Pick<CheckObservation, "nts" | "check">): boolean {
  const was = storedCheckOutcome(previous);
  if (was.version === 1) {
    assert.ok(now.check, 'a structured check record requires a structured observation');
    return isDeepStrictEqual(was.check, now.check);
  }
  if (!now.check) return outcomeText(was.category, was.nts) === outcomeText(was.category, now.nts);
  // Version zero retained summary counts and diagnostics, not individual answers.
  // Project only the fields it recorded, without manufacturing a new record.
  return isDeepStrictEqual(was.identity, legacyProjection(was.identity, now.check));
}

function legacyIdentity(record: { category: string; nts: string }): LegacyIdentity {
  const text = outcomeText(record.category, record.nts).replace(/^Error: (?=invalid HIR)/, '');
  if (record.category === 'invalid-hir') return {kind: 'preparation', message: text};
  if (record.category === 'aborted') {
    const declined = /^(\d+) case\(s\) the compiled program declined$/.exec(text);
    if (declined) return {kind: 'runtime_declined', count: Number(declined[1])};
    return {kind: text.startsWith('internal ') ? 'emitter' : 'abort', message: text};
  }
  if (record.category === 'refused') {
    const backend = /^not (?:emitted|rendered): /.test(text);
    return {kind: 'refusal', stage: backend ? 'backend' : 'lowering', diagnostic: text.replace(/^not (?:emitted|rendered): /, '')};
  }
  // Old diagnostics contain unescaped unions such as `number | null`.
  // Only known clause prefixes split the historical joined display.
  const lines = text.split(/ \| (?=(?:refused: |\d+ case\(s\) the compiled program declined|Error: \d+ case\(s\) disagree|agreed on every case\b))/);
  const whole = /^checked (\d+) cases across (\d+) function\(s\)$/.exec(lines[0]);
  const partial = /^checked (\d+) of (\d+) cases; the rest were not reached(?: \(a pool value in a loop bound will do that\))?$/.exec(lines[0]);
  assert.ok(whole || partial, 'legacy outcome has no recorded population');
  const found = whole ?? partial;
  assert.ok(found);
  const result: Extract<LegacyIdentity, { kind: 'population' }> = {kind: 'population', compared: Number(found[1]), expected: Number(whole ? whole[1] : found[2]),
    functions: whole ? Number(whole[2]) : null, refusals: [], runtime_declined: 0, disagreements: 0, agreement: false};
  for (const line of lines.slice(1)) {
    if (line.startsWith('refused: ')) result.refusals.push(line.slice('refused: '.length));
    else if (/^\d+ case\(s\) the compiled program declined/.test(line)) result.runtime_declined = Number(/^\d+/.exec(line)![0]);
    else if (/^Error: \d+ case\(s\) disagree/.test(line)) result.disagreements = Number(/^Error: (\d+)/.exec(line)![1]);
    else if (/^agreed on every case(?: it compared: \d+ of \d+)?$/.test(line)) result.agreement = true;
    else throw new Error(`unknown legacy stored outcome clause: ${line}`);
  }
  return result;
}

function legacyProjection(identity: LegacyIdentity, report: CheckReport): unknown {
  const {counts, error, refusals} = report;
  const diagnostic = (one: CheckRefusal) => `${one.code} ${one.message}`;
  if (identity.kind === 'preparation' || identity.kind === 'emitter') return {kind: error?.kind, message: error?.message.replace(/^Error: /, '')};
  if (identity.kind === 'abort') return {kind: 'abort', message: report.aborts[0]};
  if (identity.kind === 'runtime_declined') return {kind: 'runtime_declined', count: counts?.runtime_declined};
  if (identity.kind === 'refusal') return {kind: 'refusal', stage: identity.stage, diagnostic: refusals.filter(one => one.stage === identity.stage).map(diagnostic)[0]};
  if (!counts) return null;
  return {kind: 'population', compared: counts.compared, expected: counts.expected,
    functions: identity.functions === null ? null : counts.functions,
    refusals: refusals.filter(one => one.stage === 'lowering').map(diagnostic),
    runtime_declined: counts.runtime_declined, disagreements: counts.disagreements,
    agreement: report.status === 'agrees' || report.status === 'partial'};
}

/** Shell consumers receive a disposition derived here from fields, never a sentence. */
export async function runCheck(binary: string, project: string, options: CheckRunOptions = {}) {
  const format = await checkFormat(binary, options);
  const result = await checkedCommand(binary, checkArguments(format, project), {...options, maxBuffer: 64 * 1024 * 1024});
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
      return {record, result, format, incomplete: chosen.kind === 'tooling-setup' ? new ToolingInstrumentError('tooling-setup', chosen.reason) : new CommandNotMeasuredError({...result, [chosen.kind]: chosen.reason})};
    }
    const incomplete = record.outcome !== Outcome.NOT_MEASURED ? undefined
      : record.timeouts > 0 ? new CommandNotMeasuredError({...result, hung: `check NOT RUN (hung): ${project}; ${record.timeouts} calls did not complete`})
      : new ToolingInstrumentError('tooling-setup', `check not measured: ${project}: ${record.first}`);
    return {record, result, format, incomplete};
  } catch (error) { throw checkFailure(error, options.env); }
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

function checkFailureKind(error: unknown) {
  if (error instanceof CommandNotMeasuredError || error instanceof ToolingInstrumentError) return error.kind;
  if (error instanceof PressureError) return 'memory-pressure' as const;
  if (error instanceof CaseBudgetError) return 'case-budget' as const;
  return 'tooling-setup' as const;
}

export function checkFailurePolicy(error: unknown, completedFailures: number) {
  const policy = instrumentPolicy(checkFailureKind(error), completedFailures);
  assert.ok(policy, 'invalid completed check failure count');
  return policy;
}

export function reportCheckFailure(error: unknown, env = process.env, completedFailures = 0): number {
  const failure = checkFailure(error, env, completedFailures);
  return checkFailurePolicy(failure, completedFailures).disposition === 'verdict' ? 1 : 124;
}

function checkFailure(error: unknown, env = process.env, completedFailures = 0): Error {
  const failure = error instanceof CommandNotMeasuredError || error instanceof ToolingInstrumentError ||
    error instanceof PressureError || error instanceof CaseBudgetError ? error
      : new ToolingInstrumentError('tooling-setup', `invalid check instrument: ${error instanceof Error ? error.message : String(error)}`, {cause: error});
  if (failure instanceof CommandNotMeasuredError) {
    if (failure.kind === 'hung') publishHung(failure.message, env, completedFailures);
    else publishRunaway(failure.message, env, completedFailures);
  } else if (failure instanceof ToolingInstrumentError) publishToolingFailure(failure, env);
  else publishPressure(failure, env);
  return failure;
}

async function checkedCommand(binary: string, args: string[], options: CheckRunOptions) {
  const {run = activeCommand, cwd = process.cwd(), env = process.env, ...bounds} = options;
  try {
    const result: CheckCommandResult = await run(binary, args, {cwd, env, ...bounds});
    if (result.memoryKilled) {
      const bytes = result.residentLimitBytes;
      if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) {
        throw new ToolingInstrumentError('tooling-setup', `check command was killed by a resident cap without its budget identity: ${binary}`);
      }
      throw new CaseBudgetError(`check command exceeded its ${bytes} byte resident budget: ${binary}`);
    }
    if (result.hung || result.runaway) throw new CommandNotMeasuredError(result);
    if (result.error || result.signal || result.status === null) {
      throw new ToolingInstrumentError('tooling-setup', `check command did not complete: ${binary}: ${result.error?.message ?? result.signal ?? 'missing status'}`);
    }
    if (result.status !== 0 && result.status !== 1) throw new ToolingInstrumentError('tooling-setup', `check command exited outside its result protocol: ${binary}: ${result.status}`);
    return result;
  } catch (error) { throw checkFailure(error, env); }
}

/** An owning shell step finalizes liveness evidence after all its workers finish. */
export function finishCheckStep(completedFailures: number, env = process.env): number {
  assert.ok(Number.isSafeInteger(completedFailures) && completedFailures >= 0, 'invalid completed check failure count');
  const {NTS_GATE_STEP_RESULT: path, NTS_GATE_STEP: step, NTS_GATE_STEP_ATTEMPT: attempt} = env;
  if (!path || !step || !attempt) return 124;
  const frame = readStepInstrument(path, step, attempt);
  if (!frame) throw checkFailure(new Error('an incomplete check has no typed result'), env);
  if (frame.kind === 'hung') publishHung(frame.reason, env, completedFailures);
  else if (frame.kind === 'runaway') publishRunaway(frame.reason, env, completedFailures);
  return instrumentPolicy(frame.kind, completedFailures)?.disposition === 'verdict' ? 1 : 124;
}

/** Manual instruments project the same decoded fields as the gate readers. */
export function projectCheck(record: DecodedCheck, projection: 'compiled-answers' | 'backend-refusals'): string[] {
  if (projection === 'compiled-answers') {
    assert.ok([Outcome.AGREES, Outcome.PARTIAL, Outcome.DISAGREES].some(outcome => outcome === record.outcome),
      'compiled answers need a measured comparison');
    assert.equal(record.timeouts, 0, 'compiled answers were not fully measured');
    assert.equal(record.oracleStopped, 0, 'compiled answers have an incomplete oracle');
    return record.compiledAnswers.map(answer => JSON.stringify(answer));
  }
  assert.ok(![Outcome.NOT_MEASURED, Outcome.INVALID_HIR, Outcome.NO_TYPECHECK].some(outcome => outcome === record.outcome),
    'backend availability was not measured');
  assert.ok(record.report?.status !== 'error' || record.report.error?.kind === 'backend_declined',
    'backend availability has a stage error');
  const refusals = record.refusals.filter(one => one.stage === 'backend');
  if (record.outcome === Outcome.BACKEND_DECLINED && refusals.length === 0) {
    return [record.report?.error?.message ?? record.first];
  }
  return refusals.map(one => `${one.code} ${one.message}`);
}

export const Outcome = Object.freeze({
  AGREES: "agrees",
  PARTIAL: "agrees on what it compared",
  UNAVAILABLE: "compiled bindings unavailable",
  NOTHING: "nothing to check",
  DISAGREES: "disagrees",
  ABORTED: "aborted",
  ALL_DECLINED: "declined every case",
  BACKEND_DECLINED: "backend declined",
  INVALID_HIR: "invalid HIR",
  NO_TYPECHECK: "does not typecheck",
  NOT_MEASURED: "not measured",
});

// Remove this legacy decoder once no pinned compiler or stored check record
// predates the versioned JSON report. Capability or record version selects it;
// malformed output from a JSON-capable compiler never falls back here.
const CASCADE = /^ {2}refused: (?:\S+ )?NTS100[35] /;
function legacyCheck(status: number | null, out: string): Omit<DecodedCheck, "format"> {
  const count = (re: RegExp) => Number(re.exec(out)?.[1] ?? 0);
  const reached = /^checked (\d+) of (\d+) cases/m.exec(out);
  const full = /^checked (\d+) cases across/m.exec(out);
  const record: Omit<DecodedCheck, "format" | "outcome" | "first"> & { unresolved?: boolean } = {
    status,
    missingPopulation: /oracle not measured: (?:recorded count for )?(.+?) \([a-z]+\) (?:has no unique recorded population|is not its full generated count)/.exec(out)?.[1] ?? null,
    checked: Number(reached?.[1] ?? full?.[1] ?? 0),
    expected: Number(reached?.[2] ?? full?.[1] ?? 0),
    declined: count(/^(\d+) case\(s\) the compiled program declined/m),
    timeouts: count(/^(\d+) case\(s\) ran out of time/m),
    // Lowering's refusals: each one can take a function out of what is driven.
    // `check` prints the cascades too, and `tooling/gate/example-refusals`
    // counts roots only -- the same example reads 3 here and 1 there, by
    // design, so both are kept and both are printed.
    refused: out.split("\n").filter((line) => line.startsWith("  refused: ")).length,
    refusedRoots: out.split("\n").filter((line) => line.startsWith("  refused: ") && !CASCADE.test(line)).length,
    // What the two sides answered where they differ, verbatim: two runs that
    // disagree *differently* are two different answers. Not the harness's
    // own `node stopped part-way:`, which shares the `  node ` prefix.
    answers: out.split("\n").filter((line) =>
      /^ {2}(?:nts {2}|node |the compiled program aborted: )/.test(line) && !line.startsWith("  node stopped part-way: ")),
    compiledAnswers: out.split("\n").filter(line => /^ {2}nts {2}/.test(line))
      .map(line => line.replace(/^ {2}nts +/, '')),
    refusals: [
      ...[...out.matchAll(/^ *(refused:|not emitted:|declined:) (?:\S+ )?(NTS\d+) (.*)$/gm)]
        .map(match => ({stage: match[1] === 'refused:' ? 'lowering' as const : 'backend' as const,
          code: match[2]!, message: match[3]!})),
      ...[...out.matchAll(/^(?:\S+ )?(TS\d+) (.*)$/gm)]
        .map(match => ({stage: 'typecheck' as const, code: match[1]!, message: match[2]!})),
    ],
    // The oracle died before its `done` line -- a hostile pool value can run
    // node out of heap. The cases after it are unreached on both sides, which
    // `checked` already says; the message carries node's GC log, so it is
    // counted, never compared.
    oracleStopped: out.split("\n").filter((line) => line.startsWith("  node stopped part-way: ")).length,
  };
  const first = out.split("\n").find((line) => line.trim() !== "")?.trim().slice(0, 120) ?? "(no output)";
  const outcome = (() => {
    if (status === 0) {
      if (/^nothing to check/m.test(out)) return Outcome.NOTHING;
      // The verdict line, in either spelling: `check` says how many it compared
      // when that is fewer than there were, and a log from before it did not.
      if (!/^agreed on every case(?: it compared: \d+ of \d+)?$/m.test(out)) return Outcome.NOT_MEASURED;
      if (record.checked === 0) return Outcome.ALL_DECLINED;
      const whole = record.checked === record.expected && record.declined === 0 && record.timeouts === 0;
      return whole ? Outcome.AGREES : Outcome.PARTIAL;
    }
    if (status === null) return Outcome.NOT_MEASURED;
    if (/disagree between the compiled program and node/.test(out)) return Outcome.DISAGREES;
    if (/the compiled program aborted \d+ time/.test(out)) return Outcome.ABORTED;
    if (/no case was checked: all \d+ declined/.test(out)) return Outcome.ALL_DECLINED;
    // The Wasm backend counts the shapes it declined: a function, or a public
    // surface it cannot publish.
    if (/the (?:LLVM |Wasm )?backend declined \d+ (?:function|shape)/.test(out)) return Outcome.BACKEND_DECLINED;
    if (/invalid HIR/.test(out)) return Outcome.INVALID_HIR;
    // A workspace dependency that will not resolve is not a typecheck
    // regression: `tests/programs/library` in a worktree. Same keys as the gate.
    if (/TS2307|TS6059/.test(out)) {
      record.unresolved = true;
      return Outcome.NOT_MEASURED;
    }
    if (/does not typecheck|refusing to proceed/.test(out)) return Outcome.NO_TYPECHECK;
    return Outcome.NOT_MEASURED;
  })();
  const said = record.unresolved ? "needs an installed workspace; cannot resolve here" : first;
  delete record.unresolved;
  return { outcome, ...record, first: said };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, requestedConsumer, binary, project] = process.argv.slice(2);
  try {
    if (command === 'finish') {
      process.exitCode = finishCheckStep(Number(requestedConsumer));
    } else {
    assert.ok(binary && project, 'usage: check-report.ts consume|project <consumer> <nts> <project>');
    if (command === 'project') {
      const projection = member(requestedConsumer, ['compiled-answers', 'backend-refusals'] as const, 'unknown check projection');
      const {record} = await runCheck(binary, project);
      for (const line of projectCheck(record, projection)) console.log(line);
    } else {
      assert.equal(command, 'consume', 'unknown check command');
      const consumer = member(requestedConsumer, ['program', 'benchmark', 'refusal'] as const, 'unknown check consumer');
      const {result, exitCode} = await runConsumer(binary, project, consumer);
      process.stdout.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
      process.exitCode = exitCode;
    }
    }
  } catch (error) {
    console.error('check NOT MEASURED:', error instanceof Error ? error.message : String(error));
    process.exitCode = reportCheckFailure(error);
  }
}



// Outcome text compatibility belongs to the same legacy boundary as check decoding.
/** What a finished `nts check` run decided, from its lines alone. */
function legacyOutcome(said: string[], status: number | null): CheckObservation {
  // The CLI says a decline as "17 case(s) the compiled program declined -- …",
  // count first: matched by its words, not by a line start, or it drops out
  // of the record and the check reads "agreed on every case" over cases that
  // never ran (CompilerHelper's BigInt(number) probe, 2026-10-14: 21 of 696).
  const declined = /\bcase\(s\) the compiled program declined\b/;
  // And invalid HIR by its words too: `nts check` says it as
  // "Error: invalid HIR: …", which a line-start match dropped, so the JVM
  // lane's `function ([]) {…}` over an array literal recorded as not measured
  // (2026-10-15). The prefix goes, so the record reads as `emit-c`'s does.
  const lines = said.filter(
    (l) =>
      /^(checked|agreed|disagree|declined|refused:|not emitted:|not rendered:|nothing to check|invalid HIR)/i.test(l) ||
      /\bdisagree/i.test(l) ||
      /\binvalid HIR\b/.test(l) ||
      declined.test(l),
  ).map((l) => stableCheckText(l.replace(/^Error: (?=invalid HIR)/, "")));
  const text = lines.join(" | ");
  if (/invalid HIR/.test(text)) return { category: "invalid-hir", nts: text };
  // An internal emitter error decides the run on its own: nothing was emitted
  // to compare, and the line matches no deciding prefix above (the Wasm
  // emitter's "no callable fills uniform slot N" in CookieJar#evict@raises
  // recorded as NOT MEASURED with a wall of unrelated refusals as its text,
  // 2026-10-27). The slot number moves with the program, so it comes out.
  const internal = said.find((l) => /^Error: internal \w+ emitter error\b/.test(l));
  if (internal) return { category: "aborted", nts: internal.replace(/^Error: /, "").replace(/uniform slot \d+/, "uniform slot N") };
  // **A backend's refusal by name is a refusal**, as a lowering's is: `nts
  // check` lists each function it did not emit and checks nothing. Before the
  // disagreement test, which a decline's own message can trip -- the JVM
  // emitter's "the emitter and its own accounting disagree" was recorded as a
  // wrong answer -- and which nothing compared can earn. LLVM lists each
  // function as "not rendered:", the others as "not emitted:".
  const notEmitted = lines.find((l) => /^not (?:emitted|rendered):/.test(l));
  if (notEmitted && backendDeclined(said)) {
    return { category: "refused", nts: notEmitted };
  }
  if (/disagree/i.test(text)) return { category: "wrong-answer", nts: text };
  // A stop by name, as a `build` fixture's `aborted`: the first reason, without
  // the counts, which move with the case pool. Below a disagreement, which is
  // the worse answer when a program gives both.
  const aborted = said.find((l) => l.startsWith("the compiled program aborted: "));
  if (aborted) return { category: "aborted", nts: aborted.replace(/^the compiled program aborted: /, "") };
  // **Declined is not agreed**: those cases stopped -- an uncaught throw, a
  // refusal by name -- and were never compared. The first such line, without
  // its explanation, which does not change; below a named abort, whose reason
  // says more.
  const decline = lines.find((l) => declined.test(l));
  if (decline) return { category: "aborted", nts: decline.replace(/\s+--\s.*$/, "") };
  if (/nothing to check/.test(text) && /refused:/.test(text)) {
    const first = lines.find((l) => l.startsWith("refused:"));
    // A location, if the line carries one, is where the fixture's text puts the
    // refusal, not what was refused: moving a line must not change an outcome.
    return { category: "refused", nts: first!.replace(/^refused:\s*(?:\S+:\d+:\d+:\s+)?/, "") };
  }
  if (/agreed on every case/.test(text)) return { category: "agrees", nts: text };
  return { category: "not-measured", nts: text || `nts check exited ${status} and said nothing that decides` };
}


const backendDeclined = (said: string[]) => said.some(line => /\bthe (?:LLVM |Wasm )?backend declined\b/.test(line));
