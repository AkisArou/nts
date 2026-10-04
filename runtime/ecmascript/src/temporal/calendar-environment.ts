import type { CalendarPrimitive } from "./calendar-data.ts";
import { CalendarContext } from "./calendar-context.ts";
import { ArithmeticCalendar } from "./arithmetic-calendar.ts";
import { HebrewCalendar } from "./hebrew-calendar.ts";
import { UmmAlQuraCalendar } from "./umalqura-calendar.ts";
import { LunisolarCalendar } from "./lunisolar-calendar.ts";
import { calendarIndex, canonicalCalendarIdentifier } from "./calendar-identifier.ts";

function calendarData(
  identifier: string,
  open: ((identifier: string) => CalendarPrimitive) | undefined,
): CalendarPrimitive {
  switch (identifier) {
    case "hebrew":
      return new HebrewCalendar();
    case "chinese":
    case "dangi":
      if (open === undefined) throw new RangeError("Lunisolar calendar data is unavailable");
      return new LunisolarCalendar(identifier, open(identifier));
    case "islamic-umalqura":
      if (open === undefined) throw new RangeError("Umm al-Qura calendar data is unavailable");
      return new UmmAlQuraCalendar(open(identifier));
    case "persian":
      if (open === undefined) throw new RangeError("Persian calendar data is unavailable");
      return open(identifier);
    default:
      return new ArithmeticCalendar(identifier);
  }
}

// One lazy context per canonical identity. No host data or provider is acquired
// for ISO or the exact arithmetic calendars. Contexts never reference their
// environment, so retaining a date does not create an ownership cycle.
export class CalendarEnvironment {
  readonly #open: ((identifier: string) => CalendarPrimitive) | undefined;
  readonly #contexts = new Array<CalendarContext | undefined>(16);
  constructor(open: ((identifier: string) => CalendarPrimitive) | undefined = undefined) {
    this.#open = open;
  }

  resolve(identifier: string): CalendarContext {
    const id = canonicalCalendarIdentifier(identifier);
    const index = calendarIndex(id);
    let context = this.#contexts[index];
    if (context === undefined) {
      context = new CalendarContext(id, calendarData(id, this.#open));
      this.#contexts[index] = context;
    }
    return context;
  }
}

export function resolveCalendar(
  identifier: string,
  environment: CalendarEnvironment | undefined = undefined,
): CalendarContext | undefined {
  const id = canonicalCalendarIdentifier(identifier);
  // The ordinary ISO fast path needs no cursor, context or cache allocation.
  if (id === "iso8601") return undefined;
  return environment === undefined
    ? new CalendarContext(id, calendarData(id, undefined))
    : environment.resolve(id);
}
