import type {
  IcuNumberHandle,
  IcuTimeZoneHandle,
  IcuCollatorHandle,
  IcuDateHandle,
  IcuRelativeHandle,
  IcuPluralHandle,
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
export type CollatorCannotBeForged = MustBeFalse<{} extends IcuCollatorHandle ? true : false>;
export type CollatorIsNotNumber = MustBeFalse<
  IcuCollatorHandle extends IcuNumberHandle ? true : false
>;
export type NumberIsNotCollator = MustBeFalse<
  IcuNumberHandle extends IcuCollatorHandle ? true : false
>;
export type DateCannotBeForged = MustBeFalse<{} extends IcuDateHandle ? true : false>;
export type DateIsNotCalendar = MustBeFalse<IcuDateHandle extends IcuTimeZoneHandle ? true : false>;
export type CalendarIsNotDate = MustBeFalse<IcuTimeZoneHandle extends IcuDateHandle ? true : false>;
export type RelativeCannotBeForged = MustBeFalse<{} extends IcuRelativeHandle ? true : false>;
export type RelativeIsNotNumber = MustBeFalse<
  IcuRelativeHandle extends IcuNumberHandle ? true : false
>;
export type NumberIsNotRelative = MustBeFalse<
  IcuNumberHandle extends IcuRelativeHandle ? true : false
>;
export type PluralCannotBeForged = MustBeFalse<{} extends IcuPluralHandle ? true : false>;
export type PluralIsNotNumber = MustBeFalse<IcuPluralHandle extends IcuNumberHandle ? true : false>;
export type NumberIsNotPlural = MustBeFalse<IcuNumberHandle extends IcuPluralHandle ? true : false>;
