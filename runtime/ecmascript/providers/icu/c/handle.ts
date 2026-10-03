import type { TimeZoneHandleBrand, NumberHandleBrand } from "./handle-brands.d.ts";

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
