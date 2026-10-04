import type {
  TimeZoneHandleBrand,
  NumberHandleBrand,
  LocaleHandleBrand,
  NumberRangeHandleBrand,
  CollatorHandleBrand,
  DatePatternHandleBrand,
  DateHandleBrand,
  RelativeHandleBrand,
  PluralHandleBrand,
  DisplayHandleBrand,
  SegmentHandleBrand,
  CalendarHandleBrand,
} from "./handle-brands.d.ts";

// Empty classes describe managed references, whose actual descriptor and
// lifetime are supplied by NtsBoxed. Type-only interface merging makes them
// unforgeable and mutually incompatible without adding native payload fields.
export interface IcuTimeZoneHandle extends TimeZoneHandleBrand {}
export class IcuTimeZoneHandle {
  private constructor() {}
}
export interface IcuNumberHandle extends NumberHandleBrand {}
export class IcuNumberHandle {
  private constructor() {}
}
export interface IcuLocaleHandle extends LocaleHandleBrand {}
export class IcuLocaleHandle {
  private constructor() {}
}
export interface IcuNumberRangeHandle extends NumberRangeHandleBrand {}
export class IcuNumberRangeHandle {
  private constructor() {}
}
export interface IcuCollatorHandle extends CollatorHandleBrand {}
export class IcuCollatorHandle {
  private constructor() {}
}
export interface IcuDatePatternHandle extends DatePatternHandleBrand {}
export class IcuDatePatternHandle {
  private constructor() {}
}
export interface IcuDateHandle extends DateHandleBrand {}
export class IcuDateHandle {
  private constructor() {}
}
export interface IcuRelativeHandle extends RelativeHandleBrand {}
export class IcuRelativeHandle {
  private constructor() {}
}
export interface IcuPluralHandle extends PluralHandleBrand {}
export class IcuPluralHandle {
  private constructor() {}
}
export interface IcuDisplayHandle extends DisplayHandleBrand {}
export class IcuDisplayHandle {
  private constructor() {}
}
export interface IcuSegmentHandle extends SegmentHandleBrand {}
export class IcuSegmentHandle {
  private constructor() {}
}
export interface IcuCalendarHandle extends CalendarHandleBrand {}
export class IcuCalendarHandle {
  private constructor() {}
}
