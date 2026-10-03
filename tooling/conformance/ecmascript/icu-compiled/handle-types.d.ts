import type {
  IcuNumberHandle,
  IcuTimeZoneHandle,
} from "../../../../runtime/ecmascript/providers/icu/c/handle.ts";

type MustBeFalse<T extends false> = T;
export type CalendarCannotBeForged = MustBeFalse<{} extends IcuTimeZoneHandle ? true : false>;
export type NumberCannotBeForged = MustBeFalse<{} extends IcuNumberHandle ? true : false>;
export type NumberIsNotCalendar = MustBeFalse<
  IcuNumberHandle extends IcuTimeZoneHandle ? true : false
>;
export type CalendarIsNotNumber = MustBeFalse<
  IcuTimeZoneHandle extends IcuNumberHandle ? true : false
>;
