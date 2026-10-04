import {
  nts_icu_versions_match,
  nts_icu_timezone_open,
  nts_icu_timezone_id,
  nts_icu_timezone_offset,
  nts_icu_timezone_local_offset,
  nts_icu_timezone_transition,
} from "c:nts_icu";
import type { IcuTimeZoneHandle } from "c:nts_icu";

export class IcuTimeZone {
  readonly id: string;
  private readonly handle: IcuTimeZoneHandle;
  constructor(id: string) {
    if (!nts_icu_versions_match()) throw new Error("ICU data does not match the NTS pin");
    const handle = nts_icu_timezone_open(id);
    if (handle === null) throw new RangeError("Invalid time zone: " + id);
    this.handle = handle;
    const canonical = nts_icu_timezone_id(handle);
    if (canonical === null) throw new Error("ICU time zone ID lookup failed");
    this.id = canonical;
  }
  offsetMilliseconds(milliseconds: number): number {
    return nts_icu_timezone_offset(this.handle, milliseconds);
  }
  localOffsetMilliseconds(milliseconds: number, former: boolean): number {
    return nts_icu_timezone_local_offset(this.handle, milliseconds, former);
  }
  transition(milliseconds: number, forward: boolean): number | null {
    const result = nts_icu_timezone_transition(this.handle, milliseconds, forward);
    return Number.isNaN(result) ? null : result;
  }
}
