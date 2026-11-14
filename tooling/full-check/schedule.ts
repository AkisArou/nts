// Wide runs follow verified during idle time, at most once per minimum gap.
// The nightly run can cross that gap and repeat an unchanged commit before
// benchmarks. All dates and observations come from the caller.
import type { Priority } from "../gate/memory-ledger.ts";

export type Schedule = { nightly: string };

export const DEFAULT_SCHEDULE: Schedule = { nightly: "03:00" };
export const WIDE_MIN_GAP_MS = 4 * 3_600_000;
export const NIGHTLY_IDLE_WAIT_MS = 2 * 3_600_000;

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTimes(text: string): string[] {
  const times = text.split(",").map(t => t.trim()).filter(Boolean);
  for (const time of times) if (!CLOCK.test(time)) throw new Error(`not a time of day (HH:MM): ${time}`);
  return [...new Set(times)].sort();
}

/** The time `clock` (HH:MM) on the day of `day`, local time. */
function at(day: Date, clock: string): Date {
  const [, h, m] = CLOCK.exec(clock)!;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Number(h), Number(m));
}

export type WideDecision = { due: "nightly" | "advanced" | null; waiting: string | null };

export function wideMemoryWaiter(waiting: readonly { priority: Priority; live: boolean; what: string }[]): string | null {
  const first = waiting.find(entry => entry.live && entry.priority !== "full-check");
  return first ? `${first.priority} memory request waits: ${first.what}` : null;
}

/** Eligibility does not consume a start: only the actual run changes last. */
export function wideDecision(options: {
  schedule: Schedule; last?: { commit: string; at: string }; verified: string | null;
  since: string; now: Date; busy: string | null; hardBusy?:string|null;
}): WideDecision {
  const { schedule, last, verified, now, busy } = options;
  if (!verified) return { due: null, waiting: "nothing is verified yet" };
  const start = last ? new Date(last.at) : undefined;
  const nightly = dueNightly(schedule, start ?? new Date(options.since), now);
  const due = nightly ? "nightly" : verified !== last?.commit ? "advanced" : null;
  if(options.hardBusy)return {due,waiting:options.hardBusy};
  if(due===null)return {due,waiting:null};
  if (busy && (!nightly || now.getTime() < nightly.getTime() + NIGHTLY_IDLE_WAIT_MS)) return { due, waiting: busy };
  if (!nightly && start && now.getTime() < start.getTime() + WIDE_MIN_GAP_MS) {
    return { due, waiting: `minimum wide gap until ${new Date(start.getTime() + WIDE_MIN_GAP_MS).toISOString()}` };
  }
  return { due, waiting: null };
}

/** The latest nightly slot at or before `now`: today's, or yesterday's before it. */
export function lastNightly(schedule: Schedule, now: Date): Date {
  const today = at(now, schedule.nightly);
  return today.getTime() <= now.getTime() ? today : at(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), schedule.nightly);
}

/** The nightly slot after `slot`, which replaces a night that has not run by then. */
export function nextNightly(schedule: Schedule, slot: Date): Date {
  return at(new Date(slot.getFullYear(), slot.getMonth(), slot.getDate() + 1), schedule.nightly);
}

/**
 * The nightly slot the benchmarks are due for, or null: due when the latest
 * nightly slot came after they last answered one, independently of daytime
 * wide runs.
 */
export function dueNightly(schedule: Schedule, lastAnswer: Date | undefined, now: Date): Date | null {
  const slot = lastNightly(schedule, now);
  return !lastAnswer || lastAnswer.getTime() < slot.getTime() ? slot : null;
}
