/**
 * @nts/sdk/calendar — calendars, events, reminders.
 * No Web standard exists. Needs `"calendar"`. Dates are `Date` for now;
 * this module is first in line for Temporal (DESIGN.md §6.6) because
 * all-day and floating-time events are exactly what `Date` models badly
 * — `allDay` + `timeZone` fields below are the seam for that migration.
 */
import type { Availability, SignalOptions } from "./core.d.ts";

export interface CalendarInfo {
  readonly id: string;
  readonly title: string;
  /** CSS-style hex color as the OS reports it, e.g. `"#ff9500"`. */
  readonly color?: string;
  readonly readOnly: boolean;
  /** The account/source ("iCloud", "Gmail", "Local"), OS-shaped. */
  readonly source?: string;
}

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

export interface Recurrence {
  readonly frequency: RecurrenceFrequency;
  /** Every N periods. Default 1. */
  readonly interval?: number;
  readonly until?: Date;
  readonly count?: number;
}

export interface EventAttendee {
  readonly name?: string;
  readonly email?: string;
  readonly role?: "required" | "optional" | "chair" | "non-participant";
  readonly status?: "accepted" | "declined" | "tentative" | "pending" | "unknown";
  readonly isOrganizer?: boolean;
}

export interface CalendarSource {
  readonly id: string;
  readonly name: string;
  /** "local" | "exchange" | "caldav" | "mobileme" | "subscribed" | "birthdays" | OS-shaped. */
  readonly type?: string;
}

export interface CalendarEvent {
  readonly id?: string;
  readonly calendarId: string;
  readonly title: string;
  readonly notes?: string;
  readonly location?: string;
  readonly start: Date;
  readonly end: Date;
  readonly allDay?: boolean;
  /** IANA zone for floating times, e.g. `"Europe/Berlin"`. */
  readonly timeZone?: string;
  readonly recurrence?: Recurrence;
  /** Minutes before start to alert; multiple alerts allowed. */
  readonly alerts?: readonly number[];
  readonly url?: string;
  readonly attendees?: readonly EventAttendee[];
}

export interface EventQuery {
  readonly from: Date;
  readonly to: Date;
  readonly calendarIds?: readonly string[];
}

export interface Reminder {
  readonly id?: string;
  /** Reminder-list id (calendars with reminder semantics). */
  readonly calendarId: string;
  readonly title: string;
  readonly notes?: string;
  readonly due?: Date;
  readonly completed: boolean;
  readonly priority?: "none" | "low" | "medium" | "high";
}

export interface Calendar {
  availability(): Promise<Availability>;
  calendars(): Promise<readonly CalendarInfo[]>;
  defaultCalendar(): Promise<CalendarInfo | undefined>;
  createCalendar(info: { readonly title: string; readonly color?: string; readonly sourceId?: string }): Promise<CalendarInfo>;
  updateCalendar(id: string, info: { readonly title?: string; readonly color?: string }): Promise<void>;
  deleteCalendar(id: string): Promise<void>;
  /** Accounts/sources calendars belong to (for createCalendar). */
  sources(): Promise<readonly CalendarSource[]>;
  /** Reminder lists are calendars on every supported OS; kept distinct for clarity. */
  reminderLists(): Promise<readonly CalendarInfo[]>;
  events(query: EventQuery, options?: SignalOptions): Promise<readonly CalendarEvent[]>;
  createEvent(event: CalendarEvent, options?: SignalOptions): Promise<CalendarEvent>;
  updateEvent(event: CalendarEvent & { readonly id: string }, options?: SignalOptions): Promise<void>;
  removeEvent(id: string, options?: SignalOptions): Promise<void>;
  event(id: string, options?: SignalOptions): Promise<CalendarEvent | undefined>;
  /**
   * Opens the system event editor (prefilled when given). Resolves with
   * the saved event, or null if dismissed. On iOS write-only access is
   * enough for this path.
   */
  presentEventEditor(event?: CalendarEvent, options?: SignalOptions): Promise<CalendarEvent | null>;
  reminders(listId: string, options?: SignalOptions): Promise<readonly Reminder[]>;
  createReminder(reminder: Reminder, options?: SignalOptions): Promise<Reminder>;
  updateReminder(reminder: Reminder & { readonly id: string }, options?: SignalOptions): Promise<void>;
  removeReminder(id: string, options?: SignalOptions): Promise<void>;
}

export declare const calendar: Calendar;
