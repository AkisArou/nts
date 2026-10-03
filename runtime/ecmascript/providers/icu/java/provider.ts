import { IcuTimeZone as NativeTimeZone } from "java:nts.intl";
import type { TimeZoneRules } from "../../../src/time/provider.ts";

export class IcuTimeZone implements TimeZoneRules {
  readonly id: string;
  private readonly handle: NativeTimeZone;
  constructor(id: string) {
    const handle = NativeTimeZone.open(id);
    if (handle === null) throw new RangeError("Invalid time zone: " + id);
    this.handle = handle;
    this.id = handle.id();
  }
  offsetMilliseconds(milliseconds: number): number {
    return this.handle.offsetMilliseconds(milliseconds);
  }
  localOffsetMilliseconds(milliseconds: number, former: boolean): number {
    return this.handle.localOffsetMilliseconds(milliseconds, former);
  }
  transition(milliseconds: number, forward: boolean): number | null {
    const result = this.handle.transition(milliseconds, forward);
    return Number.isNaN(result) ? null : result;
  }
}
