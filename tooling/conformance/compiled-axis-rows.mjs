// One validated boundary from per-file Node observations to axis and floor.
import assert from "node:assert/strict";
import { instrumentPolicy } from "../gate/step-result.ts";
import { ToolingInstrumentError, PressureError } from "../gate/step-result.ts";
import { CommandNotMeasuredError } from "../gate/active-command.ts";
import { memoryCause } from "../census/worker-memory.ts";
import { constants } from "node:os";

export const AXIS_PREFIX = "NTS_NODE_AXIS_RESULT ";
const kinds = ["pass", "fail", "skip", "n/a", "not-measured"];
const stopKinds = ["hung", "runaway", "tooling-setup", "tooling-cleanup", "memory-pressure"];

/** Observation failures and externally killed work cannot become artifacts. */
export function commandObservation(result, before, after, aggregateBefore, aggregateAfter, label) {
  const cause = memoryCause(before, after, aggregateBefore, aggregateAfter);
  if (cause) throw new PressureError(`${label}: OOM observation (${cause}); command not measured`);
  if (result.error) throw new ToolingInstrumentError("tooling-setup", `${label}: ${result.error.message}`);
  if (result.hung || result.runaway) throw new CommandNotMeasuredError(result);
  const signals = constants.signals;
  const signal = result.signal ?? Object.keys(signals).find(name => result.status === 128 + signals[name]);
  const crash = ["SIGSEGV", "SIGABRT", "SIGBUS", "SIGILL", "SIGFPE"];
  if (signal && !crash.some(name => signals[name] === signals[signal])) {
    throw new ToolingInstrumentError("tooling-setup", `${label}: ${signal} without an OOM observation; command not measured`);
  }
  if (result.status === null && !result.signal) throw new ToolingInstrumentError("tooling-setup", `${label}: no exit observation`);
  return result;
}

export function nodeFiles(raw) {
  assert.equal(raw?.version, 1, "unsupported Node file report");
  assert.match(raw.module, /^[a-z_]+$/);
  assert.ok(Number.isSafeInteger(raw.expected) && raw.expected > 0, "missing Node file population");
  assert.ok(Array.isArray(raw.rows) && raw.rows.length === raw.expected, "incomplete Node file population");
  const names = new Set(), tally = Object.fromEntries(kinds.map(kind => [kind, 0]));
  const rows = raw.rows.map(row => {
    assert.ok(typeof row.name === "string" && row.name.length > 0 && !names.has(row.name), "duplicate or missing Node file");
    assert.ok(kinds.includes(row.kind), "invalid Node file verdict");
    names.add(row.name); tally[row.kind]++;
    assert.ok(row.why === undefined || typeof row.why === "string", "invalid Node file reason");
    return { name: row.name, kind: row.kind, ...(row.why === undefined ? {} : { why: row.why }) };
  });
  assert.deepEqual(raw.tally, tally, "Node file tally differs from its rows");
  assert.ok(Array.isArray(raw.supervision), "missing Node supervision observations");
  const supervision = raw.supervision.map(stop => {
    assert.ok(names.has(stop.name) && stopKinds.includes(stop.kind), "invalid Node supervision observation");
    assert.ok(typeof stop.reason === "string" && stop.reason.length > 0, "empty Node supervision reason");
    assert.ok(rows.some(row => row.name === stop.name && ["fail", "not-measured"].includes(row.kind)), "stop attached to a completed pass");
    return { name: stop.name, kind: stop.kind, reason: stop.reason };
  });
  for (const row of rows.filter(row => row.kind === "not-measured")) {
    const stop = supervision.find(stop => stop.name === row.name);
    assert.ok(stop, "untyped not-measured file");
    row.reason = stop.kind === "runaway" ? "cpu" : stop.kind === "hung" ? "idle" : stop.kind;
    const original = raw.rows.find(candidate => candidate.name === row.name);
    assert.ok(original.reason === undefined || original.reason === row.reason, "inconsistent Node stop reason");
  }
  return { version: 1, module: raw.module, expected: raw.expected, rows, tally, supervision };
}

export function axisRow(raw) {
  assert.equal(raw?.version, 1, "unsupported Node axis record");
  assert.match(raw.module, /^[a-z_]+$/);
  if (raw.kind === "artifact-failure") {
    assert.ok(["build", "load"].includes(raw.phase), "invalid completed artifact phase");
    assert.ok((Number.isSafeInteger(raw.status) && raw.status > 0) || (raw.status === null && typeof raw.signal === "string"), "artifact failure has no completed exit");
    assert.ok(typeof raw.reason === "string" && raw.reason.length > 0, "artifact failure has no reason");
    return { failed: raw.reason, phase: raw.phase };
  }
  if (raw.kind === "unmeasured") {
    assert.ok(stopKinds.includes(raw.cause?.kind) && typeof raw.cause.reason === "string" && raw.cause.reason.length > 0, "invalid axis stop");
    return { unmeasured: raw.cause.reason, kind: raw.cause.kind, completedFailures: 0 };
  }
  assert.equal(raw.kind, "files", "invalid Node axis record");
  const intact = nodeFiles(raw.intact), empty = nodeFiles(raw.empty);
  assert.equal(intact.module, raw.module); assert.equal(empty.module, raw.module);
  assert.deepEqual(intact.rows.map(row => row.name).sort(), empty.rows.map(row => row.name).sort(), "axis arms tested different files");
  const stops = [...intact.supervision, ...empty.supervision];
  const emptied = new Map(empty.rows.map(row => [row.name, row]));
  const realFiles = [], hollowFiles = [], undeterminedFiles = [];
  for (const row of intact.rows) {
    const control = emptied.get(row.name);
    if (row.kind === "not-measured" || (row.kind === "pass" && control.kind === "not-measured")) undeterminedFiles.push(row.name);
    else if (row.kind === "pass" && control.kind === "pass") hollowFiles.push(row.name);
    else if (row.kind === "pass") realFiles.push(row.name);
  }
  realFiles.sort(); hollowFiles.sort(); undeterminedFiles.sort();
  const observations = { real: realFiles.length, realFiles, hollow: hollowFiles.length, hollowFiles,
    undetermined: undeterminedFiles.length, undeterminedFiles };
  if (stops.length) {
    // Emptying exports deliberately fails files; its failures cannot promote
    // a lost control measurement into evidence against the implementation.
    const completedFailures = intact.tally.fail;
    const chosen = stops.find(stop => instrumentPolicy(stop.kind, completedFailures).disposition === "operator-hold")
      ?? stops.find(stop => instrumentPolicy(stop.kind, completedFailures).disposition !== "verdict") ?? stops[0];
    return { unmeasured: chosen.reason, kind: chosen.kind, completedFailures, observations };
  }
  return { ...observations, tally: intact.tally };
}

export function axisFailure(row) {
  assert.ok(row.unmeasured && stopKinds.includes(row.kind));
  if (row.kind === "memory-pressure") return new PressureError(row.unmeasured);
  return row.kind === "hung" || row.kind === "runaway"
    ? new CommandNotMeasuredError({ status: null, signal: null, stdout: "", stderr: "", out: "", elapsedMs: 0, [row.kind]: row.unmeasured })
    : new ToolingInstrumentError(row.kind, row.unmeasured);
}

/** Human report prose never authorizes a floor result. */
export function readAxis(text) {
  const rows = new Map();
  for (const line of text.split("\n")) {
    if (!line.startsWith(AXIS_PREFIX)) continue;
    const record = JSON.parse(line.slice(AXIS_PREFIX.length));
    assert.ok(!rows.has(record.module), "duplicate Node axis module");
    rows.set(record.module, axisRow(record));
  }
  return rows;
}
