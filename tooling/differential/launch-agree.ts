// What `launch-agree` (tooling/gate/launch-agree.sh) selects and how it judges
// a column: each launch row's whole program, compared with node's on one
// backend by check-consumers.ts launches. Kept apart from that command so its
// policy is functions a test imports without starting a batch.
import assert from "node:assert/strict";
import {Outcome} from "./check-report.ts";
import type {DecodedCheck} from "./check-report-types.ts";
import {LAUNCH_DECLINES, type LaunchDecline} from "../gate/verdict-policy.ts";

/** The backends every launch row is compared on. */
export const LAUNCH_BACKENDS = ["c", "llvm", "jvm"] as const;

/**
 * The columns `launch-agree` compares: every launch row among `cases` (or the
 * one `only` names) on each backend. A selection that holds no launch row is
 * refused rather than passing with nothing compared: an `only` that names a
 * case with no launch.json, or a corpus where the marker reader finds none.
 */
export function launchColumns<Case extends {name: string}>(cases: readonly Case[], only: string | undefined,
  isLaunchRow: (row: Case) => boolean): (Case & {backend: (typeof LAUNCH_BACKENDS)[number]})[] {
  const rows = cases.filter(isLaunchRow);
  if (only !== undefined) assert.ok(rows.length === 1 && rows[0]!.name === only, `${only} is not a launch row: it has no launch.json`);
  assert.ok(rows.length > 0, "the bench cases hold no launch row, so launch-agree would compare nothing");
  return rows.flatMap(row => LAUNCH_BACKENDS.map(backend => ({...row, backend})));
}

/** One completed column, as far as its verdict reads it: the check's record and exit disposition. */
export type LaunchColumn = {entry: {name: string}; record: Pick<DecodedCheck, "outcome" | "first" | "refusals">; disposition: number};

/** How a listed decline is printed. */
export function declineText(decline: LaunchDecline): string {
  return `${decline.code} ${decline.refusal} (#${decline.task})`;
}

/** Whether the column declined with the refusal its entry names. */
function declinesAsListed(row: LaunchColumn, decline: LaunchDecline): boolean {
  return row.record.outcome === Outcome.BACKEND_DECLINED
    && row.record.refusals.some(one => one.code === decline.code && one.message.startsWith(decline.refusal));
}

/**
 * Why a launch row's column is red, or undefined when it is not: it agrees,
 * is pending (disposition 4: no `program` record yet), or is a listed decline
 * that still declines with its listed refusal. A listed row that agrees is red
 * until its LAUNCH_DECLINES entry goes.
 */
export function launchFailure(row: LaunchColumn): string | undefined {
  const listed = LAUNCH_DECLINES[row.entry.name];
  if (listed === undefined) return row.disposition === 0 || row.disposition === 4 ? undefined : row.record.first;
  if (row.disposition === 4 || declinesAsListed(row, listed)) return undefined;
  if (row.disposition === 0) return `agrees, so its LAUNCH_DECLINES entry (${declineText(listed)}) is stale: remove it from tooling/gate/verdict-policy.ts`;
  const refusals = row.record.refusals.map(one => `${one.code} ${one.message}`).join("; ") || "no refusal";
  return `listed in LAUNCH_DECLINES as refused by ${declineText(listed)}, but ${row.record.first} (${refusals})`;
}

/**
 * Whether a run that agreed on no column still accounts for every one: at
 * least one column ran, and each is pending (the full check records it) or a
 * listed decline. A run of no column accounts for nothing.
 */
export function launchesAccounted(completed: readonly Pick<LaunchColumn, "entry" | "disposition">[]): boolean {
  return completed.length > 0 && completed.every(row => row.disposition === 4 || LAUNCH_DECLINES[row.entry.name] !== undefined);
}
