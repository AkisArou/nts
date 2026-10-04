// Provider data capability; no identifier or public builtin algorithms.
import type { TimeZoneRules } from "./provider.ts";

// An injected environment capability. Pure ISO/UTC values do not own a host
// environment, and shared algorithms do not import a concrete ICU provider.
export interface TimeZoneSource {
  resolveNamed(identifier: string): TimeZoneRules;
}

export interface TimeZoneIdentifierData {
  timeZoneNames(): string[];
  canonicalTimeZone(name: string): string | undefined;
  // IANA primary identity differs from CLDR's older canonical spelling.
  primaryTimeZone(name: string): string | undefined;
  primaryTimeZoneNames(): string[];
  defaultTimeZoneIdentifier(): string;
}
