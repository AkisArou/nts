// When the wide steps run: at a few fixed times of day, and every night, when
// the benchmarks follow them. The times are the unit's to set, on the service's
// command line (`--wide-at=10:00,16:00,22:00 --nightly-at=03:00`, local time);
// these are the defaults. A slot that passes while the core is running starts
// as soon as that run ends, and one missed while the service was stopped runs
// once when it starts again, not once per slot missed. The benchmarks answer
// the nightly slot on their own: a controller that first gets to it after a
// later wide slot still makes them due.

export type Schedule = { wide: string[]; nightly: string };

export const DEFAULT_SCHEDULE: Schedule = { wide: ["10:00", "16:00", "22:00"], nightly: "03:00" };

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

export type Slot = { at: Date; nightly: boolean };

/** The latest slot at or before `now`, today's or yesterday's. */
export function lastSlot(schedule: Schedule, now: Date): Slot {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const slots: Slot[] = [];
  for (const day of [yesterday, now]) {
    for (const clock of schedule.wide) slots.push({ at: at(day, clock), nightly: false });
    slots.push({ at: at(day, schedule.nightly), nightly: true });
  }
  const past = slots.filter(slot => slot.at.getTime() <= now.getTime()).sort((a, b) => a.at.getTime() - b.at.getTime());
  return past.at(-1)!;
}

/**
 * The slot the wide steps are due for, or null: due when the latest slot
 * came after the last wide run started.
 */
export function dueSlot(schedule: Schedule, lastStart: Date | undefined, now: Date): Slot | null {
  const slot = lastSlot(schedule, now);
  return !lastStart || lastStart.getTime() < slot.at.getTime() ? slot : null;
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
 * nightly slot came after they last answered one, whatever wide slots came
 * since.
 */
export function dueNightly(schedule: Schedule, lastAnswer: Date | undefined, now: Date): Date | null {
  const slot = lastNightly(schedule, now);
  return !lastAnswer || lastAnswer.getTime() < slot.getTime() ? slot : null;
}
